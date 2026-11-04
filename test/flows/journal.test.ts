import { afterEach, beforeEach, expect, test } from 'bun:test';
import { z } from 'zod';
import { call, type Transport } from '@/contract/client';
import { routes } from '@/contract/routes';
import { runAction } from '../support/actions.ts';
import { botId, ownerId } from '../support/github.ts';
import { passChecks, widget } from '../support/repositories.ts';
import { origin, World } from '../support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

function transport(token: string): Transport {
	return request =>
		world.handle(
			new Request(`${origin}${request.path}`, {
				method: request.method,
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				...(request.body === undefined ? {} : { body: request.body }),
			}),
		);
}

const changeRows = z.array(z.object({ entity: z.string(), id: z.string(), revision: z.number() }));

test('a D1 outage keeps the outbox, and the next alarm projects it', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = transport(await world.cliSession());
	await call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send);
	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);

	world.db.failBatch = new Error('D1_ERROR: Network connection lost.');
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

	world.db.failBatch = undefined;
	await world.wait(10_000);
	expect((await call(routes.executionsList, {}, send)).map(execution => execution.id)).toEqual([prepared.id]);
	expect([...journal.snapshot().keys()].filter(key => key.startsWith('outbox:'))).toEqual([]);
	const changes = changeRows.parse(
		(await world.db.prepare('SELECT entity, id, revision FROM changes ORDER BY seq').all()).results,
	);
	expect(changes).toEqual([{ entity: 'execution', id: prepared.id, revision: 1 }]);
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

test('a push during a GitHub outage waits in the inbox and dead-letters after eight attempts', async () => {
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
});
