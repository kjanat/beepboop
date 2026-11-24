import { expect, test } from 'bun:test';
import { durableObjectState, MemoryStorage } from '@root/test/support/do-storage.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Layer } from 'effect';
import { AutomationCoordinator } from '@/automation/coordinator';

let world: World;
eachWorld(created => {
	world = created;
});

test('a coordinator builds its infrastructure once and releases it when disposed', async () => {
	let built = 0, released = 0;
	const infrastructure = Layer.merge(
		world.application,
		Layer.effectDiscard(Effect.acquireRelease(
			Effect.sync(() => {
				built++;
			}),
			() =>
				Effect.sync(() => {
					released++;
				}),
		)),
	);
	const coordinator = new AutomationCoordinator(
		durableObjectState('runtime', new MemoryStorage()),
		world.env,
		infrastructure,
	);

	await coordinator.wake();
	expect(await coordinator.exportJournal()).toEqual([{ key: 'reconcile-at', value: Date.now() }]);
	expect({ built, released }).toEqual({ built: 1, released: 0 });

	await AutomationCoordinator.dispose(coordinator);
	expect({ built, released }).toEqual({ built: 1, released: 1 });
});
