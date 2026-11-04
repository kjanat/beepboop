import { afterEach, beforeEach, expect, test } from 'bun:test';
import { z } from 'zod';
import { call, type Transport } from '@/contract/client';
import { routes } from '@/contract/routes';
import { widget } from '../support/repositories.ts';
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
