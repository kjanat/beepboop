import { expect, spyOn, test } from 'bun:test';
import { loaded, releaseSet } from '@root/test/support/release-sets.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';

let world: World;
eachWorld(created => {
	world = created;
	world.runReleaseWorkflows();
});

test('a release workflow that fails to start is started again, once even when Cloudflare drops the reply', async () => {
	const { repository, preparation, workflowId, idle } = await releaseSet(world);
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const create = world.releaseWorkflow.create.bind(world.releaseWorkflow);
	const creating = spyOn(world.releaseWorkflow, 'create')
		.mockImplementationOnce(async () => {
			throw new Error('Workflows is unavailable');
		})
		.mockImplementationOnce(async options => {
			await create(options);
			throw new Error('Connection reset');
		});
	await world.wait(1_000);
	expect(world.releaseWorkflow.instances.has(workflowId)).toBe(false);
	const wake = await storage.get(`release-wake:${preparation.id}`);
	expect(wake).toEqual({ due: Date.now() + 59_000 });

	await world.wait(60_000);
	expect(creating).toHaveBeenCalledTimes(2);
	expect(await storage.get(`release-wake:${preparation.id}`)).toBeUndefined();
	expect(await storage.get(`release-set:${preparation.id}`)).toMatchObject({ started: true });
	expect((await idle()).slice(0, 4)).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
	]);
});
