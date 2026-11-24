import { Context, Effect, Layer } from 'effect';
import { recover, retryable } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { InboxEntry, Observation } from '@/release/adapters/do/keys.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner, queueSource } from '@/release/services/coordinator/alarm-planner.ts';

export const inboxAttempts = 8;
export const observationAttempts = 10;
export const inboxBackoff = 60_000;
export const observeInterval = 60_000;
export const trackInterval = 30_000;

export class AuditTrail extends Context.Service<AuditTrail, {
	readonly record: (action: string, target: string, failure: string) => Effect.Effect<void>;
}>()('beepboopbot/release/AuditTrail') {}

export interface RetryPolicy<A> {
	readonly name: string;
	readonly space: Keyspace<A>;
	readonly deadLetters?: { readonly space: Keyspace<A>; readonly id: (entry: A) => string };
	readonly attempts: number;
	readonly due: (entry: A) => number | undefined;
	readonly attemptsOf: (entry: A) => number;
	readonly retries: (error: DomainError) => boolean;
	readonly failed: (entry: A, attempts: number, error: string, now: number) => A;
	readonly describe: (entry: A, attempts: number, error: string) => string;
}

export interface RetryQueue<A> {
	readonly drain: <R>(
		now: number,
		handle: (entry: A) => Effect.Effect<A | undefined, DomainError, R>,
	) => Effect.Effect<void, DomainError, R>;
}

export const RetryQueue = {
	make: Effect.fnUntraced(function*<A>(policy: RetryPolicy<A>) {
		const storage = yield* DurableStorage;
		const audit = yield* AuditTrail;
		yield* (yield* AlarmPlanner).register(queueSource(storage, policy.space, policy.due));
		const failed = Effect.fnUntraced(function*(id: string, entry: A, error: DomainError, now: number) {
			const attempts = policy.attemptsOf(entry) + 1;
			const reason = decodeError(error);
			const next = policy.failed(entry, attempts, reason, now);
			if (policy.retries(error) && attempts < policy.attempts) return yield* storage.put(policy.space, id, next);
			if (policy.deadLetters) yield* storage.put(policy.deadLetters.space, policy.deadLetters.id(entry), next);
			yield* storage.remove(policy.space, id);
			yield* audit.record(
				`${policy.name}.dead`,
				policy.describe(entry, attempts, reason),
				`${policy.name}.audit-failed`,
			);
		});
		const queue: RetryQueue<A> = {
			drain: Effect.fnUntraced(function*<R>(
				now: number,
				handle: (entry: A) => Effect.Effect<A | undefined, DomainError, R>,
			) {
				for (const stored of yield* storage.entries(policy.space)) {
					if (stored.kind === 'unreadable') {
						yield* storage.remove(policy.space, stored.id);
						continue;
					}
					const entry = stored.value;
					if ((policy.due(entry) ?? 0) > now) continue;
					const outcome = yield* handle(entry).pipe(
						Effect.map(next => ({ kind: 'handled' as const, next })),
						recover(error => Effect.as(failed(stored.id, entry, error, now), { kind: 'failed' as const })),
					);
					if (outcome.kind === 'failed') continue;
					yield* outcome.next === undefined
						? storage.remove(policy.space, stored.id)
						: storage.put(policy.space, stored.id, outcome.next);
				}
			}),
		};
		return queue;
	}),
};

function observations(
	name: 'observe' | 'track',
	space: Keyspace<Observation>,
	deadSpace: Keyspace<Observation>,
	interval: number,
): RetryPolicy<Observation> {
	return {
		name,
		space,
		deadLetters: { space: deadSpace, id: event => String(event.runId) },
		attempts: observationAttempts,
		due: event => event.due,
		attemptsOf: event => event.attempts ?? 0,
		retries: () => true,
		failed: (event, attempts, error, now) => ({ ...event, due: now + interval, attempts, error }),
		describe: (event, attempts, error) => `run ${event.runId} after ${attempts} attempts: ${error}`,
	};
}

export const inboxPolicy: RetryPolicy<InboxEntry> = {
	name: 'inbox',
	space: Keys.inbox,
	deadLetters: { space: Keys.inboxDead, id: entry => entry.delivery },
	attempts: inboxAttempts,
	due: entry => entry.due,
	attemptsOf: entry => entry.attempts,
	retries: retryable,
	failed: (entry, attempts, error, now) => ({
		...entry,
		attempts,
		due: now + inboxBackoff * 2 ** entry.attempts,
		error,
	}),
	describe: (entry, attempts, error) => `${entry.delivery}: ${entry.event.kind} after ${attempts} attempts: ${error}`,
};
export const observePolicy = observations('observe', Keys.observe, Keys.observeDead, observeInterval);
export const trackPolicy = observations('track', Keys.track, Keys.trackDead, trackInterval);
export function trackLater(event: Observation, now: number): Observation {
	return { repositoryId: event.repositoryId, runId: event.runId, due: now + trackInterval };
}

export class InboxQueue
	extends Context.Service<InboxQueue, RetryQueue<InboxEntry>>()('beepboopbot/release/InboxQueue')
{
	static readonly layer = Layer.effect(InboxQueue, RetryQueue.make(inboxPolicy));
}
export class ObserveQueue extends Context.Service<ObserveQueue, RetryQueue<Observation>>()(
	'beepboopbot/release/ObserveQueue',
) {
	static readonly layer = Layer.effect(ObserveQueue, RetryQueue.make(observePolicy));
}
export class TrackQueue
	extends Context.Service<TrackQueue, RetryQueue<Observation>>()('beepboopbot/release/TrackQueue')
{
	static readonly layer = Layer.effect(TrackQueue, RetryQueue.make(trackPolicy));
}
