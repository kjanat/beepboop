import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { z } from 'zod';
import { routes } from '@/contract/routes';
import { runAction } from '@root/test/support/actions.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { call, cliTransport } from '@root/test/support/client.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { passChecks, widget } from '@root/test/support/repositories.ts';
import { origin, World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

function transport(token: string) {
	return cliTransport(world, token);
}

function errors() {
	const spy = spyOn(console, 'error').mockImplementation(() => {});
	return {
		events(): unknown[] {
			const lines = spy.mock.calls.flatMap(([first]): unknown[] => {
				if (typeof first !== 'string' || !first.startsWith('{')) return [];
				const parsed: unknown = JSON.parse(first);
				return [parsed];
			});
			spy.mockRestore();
			return lines.filter(line => z.object({ event: z.string() }).safeParse(line).data?.event !== 'request.failed');
		},
	};
}

const changeRows = z.array(z.object({ entity: z.string(), id: z.string(), revision: z.number() }));

test('a D1 outage keeps the outbox, and the next alarm projects it', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);

	world.db.failBatch = new Error('D1_ERROR: Network connection lost.');
	const logged = errors();
	const prepared = await call(
		routes.releasesPrepare,
		{ repositoryId: repository.id, stream: 'main', version: '1.1.0', sourceSha: plan.sourceSha, planId: plan.planId },
		send,
	);
	expect(prepared.state).toBe('ready');
	expect(await call(routes.executionsList, {}, send)).toEqual([]);
	const journal = world.coordinators.instance(String(repository.id)).storage;
	const outbox = [...journal.snapshot().keys()].filter(key => key.startsWith('outbox:'));
	expect(outbox.length).toBe(1);
	expect(journal.alarm).toBe(Date.now() + 10_000);
	expect(logged.events()).toEqual([{ event: 'projection.failed', error: 'D1_ERROR: Network connection lost.' }]);

	world.db.failBatch = undefined;
	await world.wait(10_000);
	expect((await call(routes.executionsList, {}, send)).map(execution => execution.id)).toEqual([prepared.id]);
	expect([...journal.snapshot().keys()].filter(key => key.startsWith('outbox:'))).toEqual([]);
	const changes = changeRows.parse(
		(await world.db.prepare('SELECT entity, id, revision FROM changes ORDER BY seq').all()).results,
	);
	expect(changes).toEqual([{ entity: 'execution', id: prepared.id, revision: 1 }]);
});

test('the change feed stays empty until something changes, and reindex rebuilds a lost projection', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	expect(await call(routes.changes, { since: 0 }, send)).toEqual({ cursor: 0, changes: [] });

	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);
	const prepared = await call(
		routes.releasesPrepare,
		{ repositoryId: repository.id, stream: 'main', version: '1.1.0', sourceSha: plan.sourceSha, planId: plan.planId },
		send,
	);
	const first = await call(routes.changes, { since: 0, repositoryId: repository.id }, send);
	expect(first.changes.map(entry => [entry.entity, entry.id])).toEqual([['execution', prepared.id]]);
	world.db.reset();
	expect(await call(routes.changes, { since: first.cursor }, send)).toEqual({ cursor: first.cursor, changes: [] });
	expect(world.db.queries.filter(query => query.sql.includes('FROM changes')).length).toBe(1);
	expect(await call(routes.changes, { since: 0, repositoryId: repository.id + 1 }, send)).toEqual({
		cursor: 0,
		changes: [],
	});

	await world.db.prepare('DELETE FROM executions').run();
	expect(await call(routes.executionsList, {}, send)).toEqual([]);
	await world.db.prepare('INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
		.bind(
			'proof',
			'elevation',
			JSON.stringify({ subject: world.env.ADMIN_SUBJECT, elevated: true }),
			Date.now() + 60_000,
		)
		.run();
	expect(await call(routes.adminReindex, { proof: 'proof' }, send)).toEqual({ queued: 1 });
	expect((await call(routes.executionsList, {}, send)).map(entry => entry.id)).toEqual([prepared.id]);
	const rebuilt = await call(routes.changes, { since: first.cursor }, send);
	expect(rebuilt.changes.map(entry => [entry.entity, entry.id, entry.revision])).toEqual([
		['execution', prepared.id, 2],
	]);
});

test('a Beepboop-dispatched run gets a token while D1 holds no rows', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await call(routes.releasesPlan, request, send);
	await call(routes.releasesPrepare, { ...request, sourceSha: plan.sourceSha, planId: plan.planId }, send);
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const [promotion] = (await call(routes.executionsList, {}, send)).filter(entry => entry.operation === 'promote');
	if (!promotion) throw new Error('No promotion');
	await call(routes.executionsApprove, { id: promotion.id, repositoryId: repository.id, sourceSha: merged.sha }, send);
	await world.wait(16_000);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No dispatched run');

	for (const table of ['executions', 'repositories', 'release_events', 'changes']) {
		await world.db.prepare(`DELETE FROM ${table}`).run();
	}
	world.db.reset();
	const issued = await runAction(
		world,
		'token',
		{ repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId },
		{ EXECUTION_ID: promotion.id, PERMISSIONS: '{"contents":"write"}' },
	);
	expect(issued.outputs.token).toStartWith('ghs_');
	expect(world.db.queries.filter(query => !query.writes)).toEqual([]);
});

test('an outage retries in the inbox for eight attempts, and other failures dead-letter at once', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const inbox = () => [...storage.snapshot()].filter(([key]) => key.startsWith('inbox'));
	const github = (request: Request) => world.github.handle(request);
	const outage = () => {
		throw new TypeError('Connection reset by peer');
	};

	const docs = world.github.push(repository, { 'README.md': '# widget\n\nDocs.\n' }, 'Document the widget');
	world.network.serve('api.github.com', outage);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(inbox().map(([, entry]) => entry)).toEqual([expect.objectContaining({ attempts: 1 })]);
	world.network.serve('api.github.com', github);
	await world.wait(60_000);
	expect(inbox()).toEqual([]);
	expect((await call(routes.repositoriesList, {}, send)).map(entry => entry.sha)).toEqual([docs.sha]);

	world.network.serve('api.github.com', outage);
	await world.webhook('push', {
		ref: `refs/heads/${repository.defaultBranch}`,
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	}, '00000000-0000-4000-8000-00000000dead');
	await world.wait(60_000 * 2 ** 8);
	expect(inbox().map(([key, entry]) => [key, z.looseObject({ attempts: z.number() }).parse(entry).attempts])).toEqual([
		['inbox-dead:00000000-0000-4000-8000-00000000dead', 8],
	]);

	world.network.serve('api.github.com', github);
	world.github.suspend();
	await world.webhook('push', {
		ref: `refs/heads/${repository.defaultBranch}`,
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	}, '00000000-0000-4000-8000-0000000000ff');
	await world.wait(1_000);
	const logged = errors();
	world.db.failWrites = new Error('D1_ERROR: Network connection lost.');
	await world.webhook('push', {
		ref: `refs/heads/${repository.defaultBranch}`,
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	}, '00000000-0000-4000-8000-0000000000fe');
	await world.wait(1_000);
	world.db.failWrites = undefined;
	expect(logged.events()).toEqual([{
		event: 'inbox.audit-failed',
		target: expect.stringContaining('00000000-0000-4000-8000-0000000000fe: push after 1 attempts'),
		error: 'D1_ERROR: Network connection lost.',
	}]);
	expect(inbox().map(([key, entry]) => [key, z.looseObject({ attempts: z.number() }).parse(entry).attempts])).toEqual([
		['inbox-dead:00000000-0000-4000-8000-0000000000fe', 1],
		['inbox-dead:00000000-0000-4000-8000-0000000000ff', 1],
		['inbox-dead:00000000-0000-4000-8000-00000000dead', 8],
	]);
	const dead = await world.db.prepare('SELECT target FROM audit WHERE action=? ORDER BY created_at').bind('inbox.dead')
		.all();
	expect(z.array(z.object({ target: z.string() })).parse(dead.results).map(row => row.target)).toEqual([
		'00000000-0000-4000-8000-00000000dead: push after 8 attempts: GitHub unreachable on GET /repos/octo/widget/installation: Connection reset by peer',
		'00000000-0000-4000-8000-0000000000ff: push after 1 attempts: GitHub HTTP 403 on POST /app/installations/77/access_tokens: This installation has been suspended',
	]);
});

test('a poisoned execution is quarantined while the rest of the journal advances', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);
	const prepared = await call(
		routes.releasesPrepare,
		{ repositoryId: repository.id, stream: 'main', version: '1.1.0', sourceSha: plan.sourceSha, planId: plan.planId },
		send,
	);
	const journal = world.coordinators.instance(String(repository.id)).storage;
	await journal.put('execution:poisoned', { id: 'poisoned', repositoryId: repository.id, state: 'exploded' });

	await world.wait(20_000);
	expect(repository.pulls.length).toBe(1);
	const listed = await call(routes.executionsList, {}, send);
	expect(listed.map(execution => [execution.id, execution.state])).toEqual([[prepared.id, 'succeeded']]);
	expect(journal.snapshot().get('quarantine:poisoned')).toEqual({
		error: expect.stringContaining('expected'),
		at: Date.parse('2026-11-04T09:00:15.000Z'),
	});
	const audit = await world.db.prepare('SELECT target FROM audit WHERE action=?').bind('execution.quarantined').all();
	expect(z.array(z.object({ target: z.string() })).parse(audit.results).map(row => row.target.split(':')[0])).toEqual([
		'poisoned',
	]);

	await journal.put('execution:unaudited', { id: 'unaudited', repositoryId: repository.id, state: 'exploded' });
	const logged = errors();
	world.db.failWrites = new Error('D1_ERROR: Network connection lost.');
	await world.coordinator(repository).wake();
	await world.wait(1_000);
	world.db.failWrites = undefined;
	expect(journal.snapshot().has('quarantine:unaudited')).toBe(true);
	expect(logged.events()).toEqual([{
		event: 'quarantine.audit-failed',
		target: expect.stringMatching(/^unaudited: /),
		error: 'D1_ERROR: Network connection lost.',
	}]);
});

test('packed refs complete from the journal after the execution row is gone', async () => {
	let seen = -1;
	const { promotionId } = await packedRelease(world, async () => {
		await world.db.prepare('DELETE FROM executions').run();
		seen = z.object({ n: z.number() }).parse(
			(await world.db.prepare('SELECT COUNT(*) AS n FROM executions').all()).results[0],
		).n;
	});
	expect(seen).toBe(0);
	const restored = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM executions WHERE id=?').bind(promotionId).first(),
	);
	const publication = z.object({
		publications: z.array(z.object({ id: z.string(), outcome: z.string() })),
	}).parse(JSON.parse(restored.document));
	expect(publication.publications.some(entry => entry.id === 'refs:promote' && entry.outcome === 'succeeded')).toBe(
		true,
	);
});
