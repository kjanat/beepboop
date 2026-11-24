import type { Scope } from 'effect';
import { Clock, Context, Effect, Layer, Ref } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import type { Keyspace, Write } from '@/persistence/durable/keyspace.ts';
import { Singleton } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { Keys, wakeDue } from '@/release/adapters/do/keys.ts';

export interface DueSource {
	readonly due: (now: number) => Effect.Effect<readonly (number | undefined)[], DomainError>;
}

export function earliest(times: readonly (number | undefined)[]): number | undefined {
	const due = times.filter(time => time !== undefined);
	return due.length ? Math.min(...due) : undefined;
}

export function queueSource<A>(
	storage: DurableStorage['Service'],
	space: Keyspace<A>,
	due: (value: A) => number | undefined,
): DueSource {
	return {
		due: now =>
			storage.entries(space).pipe(
				Effect.map(entries => entries.map(entry => entry.kind === 'readable' ? (due(entry.value) ?? now) : now)),
			),
	};
}

export class AlarmPlanner extends Context.Service<AlarmPlanner, {
	readonly register: (source: DueSource) => Effect.Effect<void, never, Scope.Scope>;
	readonly nextAlarm: Effect.Effect<number | undefined, DomainError>;
	readonly arm: (at: number | undefined) => Effect.Effect<void, DomainError>;
	readonly reschedule: Effect.Effect<void, DomainError>;
	readonly reconcileDue: (now: number) => Effect.Effect<boolean, DomainError>;
	readonly requestReconcile: (at: number) => Effect.Effect<void, DomainError>;
	readonly reconcileWrite: (at: number) => Effect.Effect<Write, DomainError>;
	readonly holdReconcile: (until: number) => Effect.Effect<void, DomainError>;
	readonly releaseReconcile: Effect.Effect<void, DomainError>;
}>()('beepboopbot/release/AlarmPlanner') {
	static readonly layer = Layer.effect(
		AlarmPlanner,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const reconcileAt = storage.peek(Keys.reconcileAt).pipe(
				Effect.map(stored => stored?.kind === 'readable' ? (stored.value ?? undefined) : undefined),
			);
			const sources = yield* Ref.make<readonly DueSource[]>([
				{ due: () => reconcileAt.pipe(Effect.map(at => [at])) },
			]);
			const nextAlarm = Effect.gen(function*() {
				const now = yield* Clock.currentTimeMillis;
				const times: (number | undefined)[] = [];
				for (const source of yield* Ref.get(sources)) times.push(...(yield* source.due(now)));
				return earliest(times);
			});
			return AlarmPlanner.of({
				register: source =>
					Effect.acquireRelease(
						Ref.update(sources, registered => [...registered, source]),
						() => Ref.update(sources, registered => registered.filter(entry => entry !== source)),
					),
				nextAlarm,
				arm: Effect.fnUntraced(function*(at: number | undefined) {
					if (at === undefined) return;
					const current = yield* storage.alarm;
					if (current === null || current > at) yield* storage.setAlarm(at);
				}),
				reschedule: nextAlarm.pipe(Effect.flatMap(at => at === undefined ? Effect.void : storage.setAlarm(at))),
				reconcileDue: now =>
					storage.peek(Keys.reconcileAt).pipe(
						Effect.map(stored =>
							stored === undefined || (stored.kind === 'readable' && stored.value !== null && stored.value <= now)
						),
					),
				requestReconcile: Effect.fnUntraced(function*(at: number) {
					const current = yield* reconcileAt;
					if (current === undefined || current > at) yield* storage.write(Keys.reconcileAt, at);
				}),
				reconcileWrite: at =>
					reconcileAt.pipe(
						Effect.map(current => Singleton.write(Keys.reconcileAt, Math.min(current ?? Number.POSITIVE_INFINITY, at))),
					),
				holdReconcile: until => storage.write(Keys.reconcileAt, until),
				releaseReconcile: storage.write(Keys.reconcileAt, null),
			});
		}),
	);

	static readonly sources = Layer.effectDiscard(Effect.gen(function*() {
		const planner = yield* AlarmPlanner;
		const storage = yield* DurableStorage;
		const journal = yield* Journal;
		yield* planner.register(queueSource(storage, Keys.releaseWake, wakeDue));
		yield* planner.register({ due: now => journal.due(now).pipe(Effect.map(at => [at])) });
	}));
}
