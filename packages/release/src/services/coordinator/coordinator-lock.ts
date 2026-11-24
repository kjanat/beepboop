import { Context, Effect, Layer, Semaphore } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';

export class CoordinatorLock extends Context.Service<CoordinatorLock, {
	readonly serialized: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E | DomainError, R>;
}>()('beepboopbot/release/CoordinatorLock') {
	static readonly layer = Layer.effect(
		CoordinatorLock,
		Effect.gen(function*() {
			const journal = yield* Journal;
			const planner = yield* AlarmPlanner;
			const lock = yield* Semaphore.make(1);
			const settle = journal.project.pipe(Effect.andThen(planner.nextAlarm), Effect.flatMap(planner.arm));
			return CoordinatorLock.of({
				serialized: work =>
					Semaphore.withPermit(lock, Effect.exit(work).pipe(Effect.flatMap(exit => settle.pipe(Effect.andThen(exit))))),
			});
		}),
	);
}
