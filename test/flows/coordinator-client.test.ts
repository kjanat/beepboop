import { expect, test } from 'bun:test';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { withAutomation } from '@/automation/service';

let world: World;
eachWorld(created => {
	world = created;
});

test('a coordinator result that does not match its schema fails as an internal error', async () => {
	const coordinator = world.coordinators.instance('7').object;
	Object.defineProperty(coordinator, 'preparationVersions', { value: async () => ['1.0.0', 2] });
	Object.defineProperty(coordinator, 'wake', { value: async () => 'ignored' });

	const versions = await world.run(
		withAutomation(service => Effect.flip(service.coordinators.preparationVersions(7, 'main'))),
	);
	expect(versions.problem.code).toBe('internal');
	expect(await world.run(withAutomation(service => service.coordinators.wake(7)))).toBeUndefined();
	expect(await world.run(withAutomation(service => service.coordinators.promotions(7, 'main', '1.0.0')))).toEqual([]);
});
