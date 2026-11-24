import { expect, test } from 'bun:test';
import { call } from '@root/test/support/client.ts';
import { finish, lastRun, loaded, publish, releaseSet } from '@root/test/support/release-sets.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { roundName, untilSlotHeld } from '@/automation/release-workflow';
import { routes } from '@/contract/routes';

let world: World;
eachWorld(created => {
	world = created;
	world.runReleaseWorkflows();
});

test('a release workflow advances each operation after its dependencies and completes the release', async () => {
	const { repository, workflowId, idle, operation, stored, approve } = await releaseSet(world);
	await world.wait(1_000);
	await idle();
	await finish(world, repository, lastRun(repository, 'build.yml'), 'success');
	await idle();
	expect((await stored('build')).state).toBe('succeeded');
	expect((await approve('promote')).state).toBe('ready');
	await world.wait(1_000);
	await idle();
	world.npm.publish('widget', '1.1.0');
	await finish(
		world,
		repository,
		await publish(world, repository, operation('promote').id, { outcome: 'succeeded' }),
		'success',
	);

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'do build: reconcile 2 "succeeded"',
		'do promote: reconcile 0 "awaiting-approval"',
		'do promote: delay 0 0',
		'wait promote: wait 0 ["<promote>","1 hour"]',
		'do promote: reconcile 1 "awaiting-approval"',
		'do promote: delay 1 0',
		'wait promote: wait 1 ["<promote>","1 hour"]',
		'do promote: reconcile 2 "awaiting-approval"',
		'do promote: delay 2 0',
		'wait promote: wait 2 ["<promote>","1 hour"]',
		'do promote: reconcile 3 "dispatching"',
		'do promote: delay 3 0',
		'wait promote: wait 3 ["<promote>","1 hour"]',
		'do promote: reconcile 4 "succeeded"',
		'do Complete release',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('complete');
	expect((await stored('promote')).state).toBe('succeeded');
});

test('a release workflow reconciles again when its wait for an operation times out', async () => {
	const { workflowId, idle } = await releaseSet(world);
	await world.wait(1_000);
	await idle();
	world.releaseWorkflow.expire(workflowId);

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'do build: reconcile 2 "running"',
		'do build: delay 2 0',
		'wait build: wait 2 ["<build>","1 hour"]',
	]);
});

test('a failed release workflow records the interruption and recovery restarts it', async () => {
	const { repository, transport, preparation, merged, workflowId, idle, operation, stored } = await releaseSet(world);
	await world.wait(1_000);
	await idle();
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const key = `release-set:${preparation.id}`;
	const release = await storage.get(key);
	await storage.put(key, { target: merged.sha, ids: [operation('promote').id], workflowId, started: true });
	world.releaseWorkflow.expire(workflowId);
	await idle();
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('errored');
	expect((await stored('promote')).releaseSet?.workflowError).toBe(
		'Release coordination interrupted. Check coordination to resume.',
	);
	await storage.put(key, release);
	await call(routes.executionsRecover, { id: operation('build').id, action: 'reconcile' }, transport);

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'throw build: reconcile 2 Error(Operation is not in this release)',
		'do Record coordination failure',
		loaded(),
		'do build: reconcile 0 "running"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.restarts).toBe(1);
	expect(world.coordinators.calls.filter(entry => entry.method === 'advanceReleaseOperation')).toHaveLength(9);
	expect((await stored('promote')).releaseSet?.workflowError).toBeUndefined();
});

test('a paced release operation reserves its slot, sleeps, and waits out a registry rate limit', async () => {
	const { repository, workflowId, idle, operation, stored, approve } = await releaseSet(world, [
		{ id: 'promote', group: 'widget' },
	]);
	const promotion = operation('promote');
	const storage = world.coordinators.instance(String(repository.id)).storage;
	await storage.put(`execution:${promotion.id}`, {
		...await stored('promote'),
		package: { id: 'pkg:npm/widget', manager: 'cargo' },
	});
	await world.budgets.instance('crates-io').storage.put('arrival:update', Date.now() + 40 * 60_000);
	await world.wait(1_000);
	await idle();
	expect((await approve('promote')).state).toBe('ready');
	await world.wait(1_000);
	await idle();
	const until = new Date(Date.now() + 30 * 60_000).toISOString();
	await finish(
		world,
		repository,
		await publish(world, repository, promotion.id, { outcome: 'rate-limited', retryAfter: until }),
		'failure',
	);
	await idle();
	world.npm.publish('widget', '1.1.0');
	await finish(world, repository, await publish(world, repository, promotion.id, { outcome: 'succeeded' }), 'success');

	const label = 'promote pkg:npm/widget';
	expect(await idle()).toEqual([
		'do Load release operations [{"id":"<promote>","operation":"promote pkg:npm/widget","paced":true,"dependencies":[]}]',
		`do ${label}: reserve 659000`,
		`sleep ${label}: paced 659000`,
		`do ${label}: reserve 2 0`,
		`do ${label}: reconcile 0 "awaiting-approval"`,
		`do ${label}: delay 0 0`,
		`wait ${label}: wait 0 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 1 "awaiting-approval"`,
		`do ${label}: delay 1 0`,
		`wait ${label}: wait 1 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 2 "dispatching"`,
		`do ${label}: delay 2 0`,
		`wait ${label}: wait 2 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 3 "ready"`,
		`do ${label}: delay 3 1800000`,
		`sleep ${label}: deferred 3 1800000`,
		`do ${label}: reconcile 4 "dispatching"`,
		`do ${label}: delay 4 0`,
		`wait ${label}: wait 4 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 5 "running"`,
		`do ${label}: delay 5 1798000`,
		`sleep ${label}: deferred 5 1798000`,
		`do ${label}: reconcile 6 "running"`,
		`do ${label}: delay 6 0`,
		`wait ${label}: wait 6 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 7 "running"`,
		`do ${label}: delay 7 0`,
		`wait ${label}: wait 7 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 8 "succeeded"`,
		'do Complete release',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('complete');
	expect(world.budgets.calls.map(entry => entry.method)).toEqual(['reserve', 'reserve', 'defer']);
});

test('a paced operation reserves again after each sleep until no wait remains', async () => {
	const waits = [60_000, 30_000, 0];
	const steps: string[] = [];
	await Effect.runPromise(untilSlotHeld(
		round =>
			Effect.sync(() => {
				steps.push(roundName('crate: reserve', round));
				return waits[round - 1] ?? 0;
			}),
		(round, wait) =>
			Effect.sync(() => {
				steps.push(`${roundName('crate: paced', round)} ${wait}`);
			}),
	));
	expect(steps).toEqual([
		'crate: reserve',
		'crate: paced 60000',
		'crate: reserve 2',
		'crate: paced 2 30000',
		'crate: reserve 3',
	]);
});

test('the first round keeps the step names of a workflow already running', () => {
	expect([roundName('crate: reserve', 1), roundName('crate: paced', 1)]).toEqual(['crate: reserve', 'crate: paced']);
});
