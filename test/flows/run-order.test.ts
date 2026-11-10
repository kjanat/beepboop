import { beforeEach, expect, test } from 'bun:test';
import { savedClient } from '@root/test/support/cli.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import { Store } from '@/automation/store';
import type { Client } from '@/cli/client';
import type { executionFilter } from '@/contract/routes';
import { routes } from '@/contract/routes';

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
	const row = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM executions WHERE id=?').bind(prepared.id).first(),
	);
	await world.db.prepare('DELETE FROM executions WHERE id=?').bind(prepared.id).run();
	return { repositoryId: repository.id, document: z.record(z.string(), z.unknown()).parse(JSON.parse(row.document)) };
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

const listed = (input: z.input<typeof executionFilter>) =>
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
	expect(everything.at(-1)).toBe('legacy-stuck');
	expect(await listed({ stream: 'main', limit: 1 })).toEqual(['legacy-awaiting']);
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
