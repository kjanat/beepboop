import { Clock, Effect } from 'effect';
import type { ReleaseSets } from '@/automation/release-sets.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';

export function wakeUp(
	sets: ReleaseSets['Service'],
	planner: AlarmPlanner['Service'],
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const clock = yield* Clock.Clock;
		yield* sets.wake;
		yield* planner.requestReconcile(clock.currentTimeMillisUnsafe());
		yield* planner.arm(clock.currentTimeMillisUnsafe());
	});
}
