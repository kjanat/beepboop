import { Clock, Context, Effect, Layer, Ref, Schema, Semaphore } from 'effect';
import type { ProjectedEntity } from '@/contract/changes';
import { projectedEntities } from '@/contract/changes';
import { recover } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { logFailure } from '@/kernel/logging/failure-log.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableStruct, safeDecode } from '@/kernel/schema/structs.ts';
import type { Projection } from '@/persistence/d1/projection';
import type { Singleton, Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';

export interface EntityRef {
	entity: ProjectedEntity;
	id: string;
	repositoryId: number;
}
export interface Committed extends EntityRef {
	value: unknown;
}

const batch = 64;
const projectionRetry = 10_000;
export const journalSequence = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0));
export const outboxEntry = mutableStruct({
	entity: Schema.Literals(projectedEntities),
	id: Schema.String,
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	revision: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
});
export type OutboxEntry = Decoded<typeof outboxEntry>;
export interface JournalLayout {
	readonly entities: Record<ProjectedEntity, Keyspace<unknown>>;
	readonly outbox: Keyspace<OutboxEntry>;
	readonly sequence: Singleton<number>;
}
const projectedExecution = looseStruct({ state: Schema.String, updatedAt: Schema.Finite });

function projection(entry: OutboxEntry, value: unknown, now: number): Projection | undefined {
	if (value === undefined) return undefined;
	const document = JSON.stringify(value);
	const common = { id: entry.id, repositoryId: entry.repositoryId, revision: entry.revision, document };
	if (entry.entity !== 'execution') return { ...common, entity: entry.entity, updatedAt: now };
	const parsed = safeDecode(projectedExecution, value);
	if (!parsed.success) return undefined;
	return { ...common, entity: 'execution', state: parsed.data.state, updatedAt: parsed.data.updatedAt };
}

function writes(record: Record<string, unknown>): Write[] {
	return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export class ProjectionSink extends Context.Service<ProjectionSink, {
	readonly apply: (rows: readonly Projection[]) => Effect.Effect<void, DomainError>;
}>()('beepboopbot/persistence/ProjectionSink') {}

export class Journal extends Context.Service<Journal, {
	readonly commit: (
		entries: readonly [Committed, ...Committed[]],
		extra?: readonly Write[],
	) => Effect.Effect<void, DomainError>;
	readonly reindex: (repositoryId: number) => Effect.Effect<number, DomainError>;
	readonly project: Effect.Effect<void>;
	readonly due: (now: number) => Effect.Effect<number | undefined, DomainError>;
}>()('beepboopbot/persistence/Journal') {
	static layer(layout: JournalLayout): Layer.Layer<Journal, never, DurableStorage | ProjectionSink> {
		return Layer.effect(
			Journal,
			Effect.gen(function*() {
				const storage = yield* DurableStorage;
				const sink = yield* ProjectionSink;
				const revision = yield* Ref.make<number | undefined>(undefined);
				const retryAt = yield* Ref.make<number | undefined>(undefined);
				const sequence = yield* Semaphore.make(1);
				const draining = yield* Semaphore.make(1);
				const keyOf = (ref: Pick<EntityRef, 'entity' | 'id'>) => Keyspace.key(layout.entities[ref.entity], ref.id);
				const outboxId = (at: number) => String(at).padStart(16, '0');
				const next = Semaphore.withPermit(
					sequence,
					Effect.gen(function*() {
						const current = (yield* Ref.get(revision)) ?? (yield* storage.read(layout.sequence)) ?? 0;
						yield* Ref.set(revision, current + 1);
						return current + 1;
					}),
				);
				const commit = Effect.fnUntraced(function*(
					entries: readonly [Committed, ...Committed[]],
					extra: readonly Write[] = [],
				) {
					const changes: Record<string, unknown>[] = [];
					let at = 0;
					for (const { value, ...ref } of entries) {
						at = yield* next;
						changes.push({
							[keyOf(ref)]: value,
							[Keyspace.key(layout.outbox, outboxId(at))]: { ...ref, revision: at },
						});
					}
					const chunks: Record<string, unknown>[] = [{
						...Object.fromEntries(extra.map(write => [write.key, write.value])),
						[layout.sequence.key]: at,
					}];
					for (const change of changes) {
						const last = chunks.at(-1);
						if (last && Object.keys(last).length + 2 <= 128) Object.assign(last, change);
						else chunks.push({ ...change });
					}
					const [only] = chunks;
					if (chunks.length === 1 && only) yield* storage.writeAll(writes(only));
					else yield* storage.transaction(chunks.map(writes));
				});
				const reindex = Effect.fnUntraced(function*(repositoryId: number) {
					let queued = 0;
					for (const entity of projectedEntities) {
						const space = layout.entities[entity];
						const ids = yield* storage.ids(space);
						for (let i = 0; i < ids.length; i += batch) {
							const queue: Record<string, unknown> = {};
							for (const id of ids.slice(i, i + batch)) {
								const at = yield* next;
								queue[Keyspace.key(layout.outbox, outboxId(at))] = { entity, id, repositoryId, revision: at };
								queue[layout.sequence.key] = at;
							}
							yield* storage.writeAll(writes(queue));
							queued += ids.slice(i, i + batch).length;
						}
					}
					return queued;
				});
				const pending = storage.entries(layout.outbox, 1).pipe(Effect.map(entries => entries.length > 0));
				const flush = Effect.gen(function*() {
					const clock = yield* Clock.Clock;
					for (;;) {
						const entries = yield* storage.entries(layout.outbox, batch);
						if (!entries.length) return;
						const latest = new Map<string, OutboxEntry>();
						for (const entry of entries) {
							if (entry.kind === 'unreadable') continue;
							const key = keyOf(entry.value);
							if ((latest.get(key)?.revision ?? 0) < entry.value.revision) latest.set(key, entry.value);
						}
						const values = yield* storage.values([...latest.keys()]);
						const now = clock.currentTimeMillisUnsafe();
						yield* sink.apply([...latest].flatMap(([key, entry]) => projection(entry, values.get(key), now) ?? []));
						yield* storage.removeAll(layout.outbox, entries.map(entry => entry.id));
					}
				});
				const project = Semaphore.withPermit(draining, flush).pipe(
					Effect.andThen(Ref.set(retryAt, undefined)),
					recover(error =>
						Clock.currentTimeMillis.pipe(
							Effect.flatMap(now => Ref.set(retryAt, now + projectionRetry)),
							Effect.andThen(logFailure('projection.failed', error)),
						)
					),
				);
				const due = (now: number) =>
					pending.pipe(
						Effect.flatMap(waiting => waiting ? Ref.get(retryAt).pipe(Effect.map(at => at ?? now)) : Effect.undefined),
					);
				return Journal.of({ commit, reindex, project, due });
			}),
		);
	}
}
