import { Clock, Context, Effect, Layer } from 'effect';
import { Inbox } from '@/automation/inbox.ts';
import { Reconciler } from '@/automation/reconciler.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import { RunObservation } from '@/automation/run-observation.ts';
import { SetupEdits } from '@/automation/setup-edits.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { ObserveQueue, TrackQueue, trackLater } from '@/release/services/coordinator/retry-queue.ts';

export class Alarm extends Context.Service<Alarm, {
	readonly fire: Effect.Effect<void, DomainError>;
}>()('beepboop/automation/Alarm') {
	static readonly layer = Layer.effect(
		Alarm,
		Effect.gen(function*() {
			const lock = yield* CoordinatorLock;
			const inbox = yield* Inbox;
			const sets = yield* ReleaseSets;
			const observation = yield* RunObservation;
			const observe = yield* ObserveQueue;
			const track = yield* TrackQueue;
			const planner = yield* AlarmPlanner;
			const reconciler = yield* Reconciler;
			const setupEdits = yield* SetupEdits;
			return Alarm.of({
				fire: Effect.gen(function*() {
					const now = (yield* Clock.Clock).currentTimeMillisUnsafe();
					yield* inbox.drain(now);
					yield* Effect.all([
						lock.serialized(Effect.gen(function*() {
							yield* sets.deliver(now);
							yield* observe.drain(now, event => Effect.as(observation.observe(event), undefined));
							yield* track.drain(
								now,
								event => observation.track(event).pipe(Effect.map(done => done ? undefined : trackLater(event, now))),
							);
							if (yield* planner.reconcileDue(now)) yield* reconciler.reconcile();
						})),
						lock.serialized(setupEdits.rebuildDue),
					], { concurrency: 'unbounded' });
					yield* planner.reschedule;
				}),
			});
		}),
	);
}
