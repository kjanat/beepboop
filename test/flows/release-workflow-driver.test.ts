import { expect, test } from 'bun:test';
import { releaseSet } from '@root/test/support/release-sets.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { CoordinatorClient } from '@/automation/coordinator-client.ts';
import type { ReleaseSteps } from '@/automation/release-workflow-driver.ts';
import { driveRelease } from '@/automation/release-workflow-driver.ts';

let world: World;
eachWorld(created => {
	world = created;
});

test('the release driver runs over plain steps and records a coordination failure', async () => {
	const { repository, preparation } = await releaseSet(world);
	const names: string[] = [];
	const steps: ReleaseSteps = {
		run: (name, work) => Effect.sync(() => names.push(name)).pipe(Effect.andThen(work)),
		sleep: name => Effect.sync(() => names.push(name)),
		wait: name => Effect.sync(() => names.push(name)),
	};
	const failure = await Effect.runPromise(
		driveRelease(steps, { repositoryId: repository.id, preparationId: preparation.id, workflowId: 'other' }).pipe(
			Effect.flip,
			Effect.provide(CoordinatorClient.layer(id => world.coordinators.getByName(String(id)))),
		),
	);
	expect(failure.message).toBe('Release Workflow identity mismatch');
	expect(names).toEqual(['Load release operations', 'Record coordination failure']);
});
