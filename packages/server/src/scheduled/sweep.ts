import { CronExpressionParser } from 'cron-parser';
import { Clock, Context, Effect, Layer } from 'effect';
import { CoordinatorClient } from '@/automation/coordinator-client.ts';
import { deliverReleaseEvents, ReleaseEventSink } from '@/automation/release-event-outbox.ts';
import type { AutomationService } from '@/automation/service.ts';
import { Automation } from '@/automation/service.ts';
import type { ReadyRepository } from '@/domain/repository';
import { readiness } from '@/domain/repository';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { deliverPending } from '@/notifications/event-delivery.ts';
import { pollPackages } from '@/notifications/package-watch.ts';
import { createExecution } from '@/release/domain/execution/execution.ts';

const changeRetention = 7 * 24 * 60 * 60 * 1000;

const scheduleStreams = Effect.fnUntraced(
	function*(automation: AutomationService, ready: ReadyRepository, now: number) {
		for (const [streamName, stream] of Object.entries(ready.configuration.streams)) {
			for (const [operation, binding] of Object.entries(stream.workflows)) {
				if (!binding.schedule) continue;
				const expression = binding.schedule;
				const key = `${ready.id}:${streamName}:${operation}:${expression}`;
				const cursor = yield* automation.schedules.cursor(key);
				if (cursor === undefined) {
					yield* automation.schedules.start(key, now);
					continue;
				}
				const schedule = yield* fromSync(() =>
					CronExpressionParser.parse(expression, { currentDate: cursor, tz: 'UTC' })
				);
				for (let n = 0; n < 100; n++) {
					const tick = schedule.next().getTime();
					if (tick > now) break;
					const execution = yield* createExecution(ready, {
						stream: streamName,
						operation,
						eventId: `schedule:${tick}`,
						sourceSha: ready.sha,
					});
					yield* automation.enqueue(ready, execution);
					yield* automation.schedules.advance(key, tick);
				}
			}
		}
	},
);

const scheduledRepository = Effect.fnUntraced(function*(
	automation: AutomationService,
	repository: { name: string; id: number },
) {
	const clock = yield* Clock.Clock;
	const refreshed = yield* automation.catalog.refresh(repository.name, repository.id);
	yield* automation.winget().automatic(refreshed).pipe(
		automation.store.auditFailure('winget', 'winget.failed', repository.name),
	);
	yield* automation.coordinators.wake(repository.id);
	yield* deliverReleaseEvents(repository.id).pipe(
		Effect.provideService(CoordinatorClient, automation.coordinators),
		Effect.provideService(ReleaseEventSink, ReleaseEventSink.of({ deliver: event => automation.event(event) })),
	);
	const state = readiness(refreshed);
	if (state.kind !== 'ready') return;
	yield* scheduleStreams(automation, state.repository, clock.currentTimeMillisUnsafe());
});

export function sweep(automation: AutomationService): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const clock = yield* Clock.Clock;
		yield* automation.sessions.sweep();
		yield* automation.changes.prune(clock.currentTimeMillisUnsafe() - changeRetention);
		yield* Effect.suspend(() => deliverPending(automation.eventDelivery()));
		yield* automation.winget().reconcile();
		for (const repository of yield* automation.store.repositories.enrollments()) {
			// Next scheduled pass retries; preserve the last known configuration.
			yield* scheduledRepository(automation, repository).pipe(
				logRecovered('repository.scheduled.failed', { repositoryId: repository.id, repository: repository.name }),
			);
		}
		const notifications = automation.notifications();
		const readable = yield* automation.store.repositories.readable();
		yield* pollPackages(
			automation.store.db,
			readable,
			automation.dependencies.transport,
			event => automation.event(event),
			notifications,
		);
		yield* notifications.deliver();
	});
}

export class ScheduledSweep extends Context.Service<ScheduledSweep, {
	readonly run: Effect.Effect<void, DomainError>;
}>()('beepboop/server/ScheduledSweep') {
	static readonly layer = Layer.effect(
		ScheduledSweep,
		Effect.gen(function*() {
			return ScheduledSweep.of({ run: sweep(yield* Automation) });
		}),
	);
}
