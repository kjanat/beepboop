import { beforeEach, expect, test } from 'bun:test';
import { savedClient } from '@root/test/support/cli.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Schema, Struct } from 'effect';
import { Store } from '@/automation/store';
import type { Client } from '@/cli/client';
import type { executionFilter } from '@/contract/routes';
import { routes } from '@/contract/routes';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';
import { loaders } from '@/server/loaders';

let world: World, directory: string, client: Client, token: string;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-order-', created => {
	directory = created;
});
beforeEach(async () => {
	({ client, token } = await savedClient(world, directory));
});

async function template() {
	const repository = await discoveredWidget(world, token);
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const plan = await Effect.runPromise(client.call(routes.releasesPlan, request));
	const prepared = await Effect.runPromise(
		client.call(routes.releasesPrepare, { ...request, sourceSha: plan.sourceSha, planId: plan.planId }),
	);
	const row = decodeSync(
		mutableStruct({ document: Schema.String }),
		await world.db.prepare('SELECT document FROM executions WHERE id=?').bind(prepared.id).first(),
	);
	await world.db.prepare('DELETE FROM executions WHERE id=?').bind(prepared.id).run();
	return {
		repositoryId: repository.id,
		document: decodeSync(mutableRecord(Schema.String, Schema.Unknown), JSON.parse(row.document)),
	};
}

type Row = [id: string, state: string, createdAt: number, updatedAt: number, changes?: Record<string, unknown>];

async function insert(base: Awaited<ReturnType<typeof template>>, rows: Row[]) {
	const statement = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	await world.db.batch(rows.map(([id, state, createdAt, updatedAt, changes]) =>
		statement.bind(
			id,
			base.repositoryId,
			state,
			JSON.stringify({ ...base.document, id, state, createdAt, updatedAt, ...changes }),
			updatedAt,
		)
	));
}

const listed = (input: Encoded<typeof executionFilter>) =>
	Effect.runPromise(client.call(routes.executionsList, input)).then(rows => rows.map(entry => entry.id));

test('an old run cancelled after a newer run started is listed below it', async () => {
	const base = await template();
	await insert(base, [
		['old-cancelled', 'cancelled', 1_000, 9_000],
		['new-running', 'running', 2_000, 3_000],
		['newest-failed', 'failed', 3_000, 4_000],
		['new-pending', 'pending', 2_500, 2_500],
	]);
	const expected = ['new-pending', 'new-running', 'newest-failed', 'old-cancelled'];
	expect(await listed({})).toEqual(expected);
	expect(await listed({ stream: 'main' })).toEqual(expected);
	expect(await listed({ repository: 'octo/widget' })).toEqual(expected);
	expect(await listed({ stream: 'main', limit: 2 })).toEqual(expected.slice(0, 2));
	expect(await listed({ states: 'cancelled,running' })).toEqual(['new-running', 'old-cancelled']);
	const store = new Store(world.db);
	expect(
		(await Effect.runPromise(store.readExecutions())).map(entry => entry.kind === 'readable' ? entry.value.id : ''),
	)
		.toEqual(expected);
	expect((await Effect.runPromise(store.executions(base.repositoryId))).map(entry => entry.id)).toEqual(expected);
});

test('unfinished runs are chosen before the 200 row limit, whatever finished runs were touched since', async () => {
	const base = await template();
	await insert(base, [
		['long-running', 'running', 1, 1],
		...Array.from({ length: 205 }, (_, index): Row => [
			`finished-${String(index).padStart(3, '0')}`,
			'succeeded',
			10 + index,
			100 + index,
		]),
	]);
	const everything = await listed({});
	expect(everything).toHaveLength(200);
	expect(everything[0]).toBe('long-running');
	expect(everything[1]).toBe('finished-204');
	expect(await listed({ stream: 'main', limit: 1 })).toEqual(['long-running']);
	expect(await listed({ stream: 'main', states: 'succeeded', limit: 1 })).toEqual(['finished-204']);
});

test('legacy blocked rows rank by the state they decode to and stay inside the 200 row limit', async () => {
	const base = await template();
	const { approvedAt: _approvedAt, runId: _runId, ...plain } = base.document;
	const legacy = { ...base, document: plain };
	await insert(legacy, [
		['legacy-awaiting', 'blocked', 5, 5, { operation: 'promote', attempts: 0 }],
		['legacy-stuck', 'blocked', 6, 6, { operation: 'prepare', attempts: 1 }],
		...Array.from({ length: 205 }, (_, index): Row => [
			`finished-${String(index).padStart(3, '0')}`,
			'succeeded',
			10 + index,
			100 + index,
		]),
	]);
	const everything = await listed({});
	expect(everything).toHaveLength(200);
	expect(everything[0]).toBe('legacy-awaiting');
	expect(everything[1]).toBe('finished-204');
	expect(everything).not.toContain('legacy-stuck');
	expect(await listed({ stream: 'main', limit: 1 })).toEqual(['legacy-awaiting']);
	const read = await Effect.runPromise(new Store(world.db).readExecutions());
	expect(read.flatMap(entry => entry.kind === 'readable' ? [entry.value.id] : [])).toEqual(everything);
});

test('blocked runs that stay blocked do not push an older pending run out of the 200 row limit', async () => {
	const base = await template();
	const { approvedAt: _approvedAt, runId: _runId, ...plain } = base.document;
	await insert({ ...base, document: plain }, [
		['older-pending', 'pending', 1, 1],
		...Array.from({ length: 201 }, (_, index): Row => [
			`blocked-${String(index).padStart(3, '0')}`,
			'blocked',
			10 + index,
			10 + index,
			{ operation: 'prepare', attempts: 1 },
		]),
	]);
	const everything = await listed({});
	expect(everything).toHaveLength(200);
	expect(everything[0]).toBe('older-pending');
	expect(await listed({ stream: 'main', limit: 1 })).toEqual(['older-pending']);
	expect(await listed({ states: 'pending,blocked', limit: 2 })).toEqual(['older-pending', 'blocked-200']);
	const read = await Effect.runPromise(new Store(world.db).readExecutions());
	expect(read.flatMap(entry => entry.kind === 'readable' ? [entry.value.id] : [])).toEqual(everything);
});

test('a malformed stored document stays an unreadable row and does not break ordering or filters', async () => {
	const base = await template();
	await insert(base, [
		['old-cancelled', 'cancelled', 1_000, 9_000],
		['new-running', 'running', 2_000, 3_000],
	]);
	await world.db.prepare('INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)')
		.bind('malformed', base.repositoryId, 'running', '{not json', 10_000).run();
	const read = await Effect.runPromise(new Store(world.db).readExecutions());
	expect(read.map(entry => entry.kind === 'readable' ? entry.value.id : `unreadable:${entry.id}`)).toEqual([
		'new-running',
		'old-cancelled',
		'unreadable:malformed',
	]);
	expect(await listed({ stream: 'main' })).toEqual(['new-running', 'old-cancelled']);
});

test('a corrupt blocked row outside the requested page does not fail a limited list', async () => {
	const base = await template();
	await insert(base, [['new-running', 'running', 2_000, 3_000]]);
	const statement = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	await world.db.batch([
		statement.bind('blocked-garbage', base.repositoryId, 'blocked', '{not json', 1),
		statement.bind('blocked-invalid', base.repositoryId, 'blocked', '{}', 2),
	]);
	expect(await listed({ limit: 1 })).toEqual(['new-running']);
	expect(await listed({ limit: 1, states: 'running,blocked' })).toEqual(['new-running']);
});

test('runs that tie on state and creation time keep the same order inside and after the 200 row limit', async () => {
	const base = await template();
	await insert(base, [
		['a', 'pending', 1, 10],
		['z', 'pending', 1, 20],
		...Array.from({ length: 199 }, (_, index): Row => [
			`newer-${String(index).padStart(3, '0')}`,
			'pending',
			10 + index,
			10 + index,
		]),
	]);
	const everything = await listed({});
	expect(everything).toHaveLength(200);
	expect(everything.at(-1)).toBe('a');
	expect(everything).not.toContain('z');
	expect(await listed({ stream: 'main' })).toEqual(everything);
});

test('the releases page still receives a fresh succeeded run when 200 unfinished runs exist', async () => {
	const base = await template();
	await insert(base, [
		['done', 'succeeded', 1, 1],
		...Array.from({ length: 200 }, (_, index): Row => [
			`running-${String(index).padStart(3, '0')}`,
			'running',
			10 + index,
			10 + index,
		]),
	]);
	const data = await world.run(loaders.releases({ env: world.env, actor: 'admin' }));
	expect(data.executions.map(entry => entry.id)).toEqual(['done']);
});

test('the run list reads executions in index order and caps the blocked rows that stay blocked', async () => {
	const base = await template();
	const { approvedAt: _approvedAt, runId: _runId, ...plain } = base.document;
	await insert({ ...base, document: plain }, [
		['legacy-awaiting', 'blocked', 5, 5, { operation: 'promote', attempts: 0 }],
		['legacy-stuck', 'blocked', 6, 6, { operation: 'prepare', attempts: 1 }],
		['new-running', 'running', 7, 7],
	]);
	world.db.reset();
	expect(await listed({})).toEqual(['new-running', 'legacy-awaiting', 'legacy-stuck']);
	const lists = world.db.queries.filter(query => /FROM executions WHERE .* ORDER BY/.test(query.sql));
	expect(lists).toHaveLength(3);
	for (const query of lists) {
		const plan = world.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values).map(step =>
			String(Reflect.get(step ?? {}, 'detail'))
		);
		expect(plan).toEqual([
			`SCAN executions USING INDEX ${
				query.sql.includes("state='blocked'") ? 'executions_blocked' : 'executions_listed'
			}`,
		]);
	}
	expect(lists.filter(query => query.sql.includes("state='blocked'"))).toHaveLength(2);
	expect(lists.filter(query => !query.sql.includes('LIMIT ?')).map(query => query.sql.includes(' AND COALESCE(')))
		.toEqual([true]);
});

test('a short ID is found by an index search on the execution ID', async () => {
	const base = await template();
	await insert(base, [['abcdef0123456789', 'running', 1, 1], ['abcdef01ffffffff', 'running', 2, 2]]);
	const store = new Store(world.db);
	expect(await Effect.runPromise(store.executionsStarting('abcdef012'))).toEqual([
		{ id: 'abcdef0123456789', repositoryId: base.repositoryId },
	]);
	expect(await Effect.runPromise(store.executionsStarting('abcdef01'))).toHaveLength(2);
	expect(await Effect.runPromise(store.executionsStarting('abcdef02'))).toEqual([]);
	const [query] = world.db.queries.slice(-1);
	if (!query) throw new Error('Expected the prefix query');
	const plan = world.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values).map(step =>
		String(Reflect.get(step ?? {}, 'detail'))
	);
	expect(plan).toEqual(['SEARCH executions USING INDEX sqlite_autoindex_executions_1 (id>? AND id<?)']);
});
