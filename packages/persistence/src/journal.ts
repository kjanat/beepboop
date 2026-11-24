import { Clock, Effect, Schema, Semaphore } from 'effect';
import type { ProjectedEntity } from '@/contract/changes';
import { projectedEntities } from '@/contract/changes';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableStruct, safeDecode } from '@/kernel/schema/structs.ts';
import type { Projection } from '@/persistence/d1/projection';
import type { Singleton, Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';

export interface EntityRef {
	entity: ProjectedEntity;
	id: string;
	repositoryId: number;
}
export interface Committed extends EntityRef {
	value: unknown;
}

const batch = 64;
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

export function earliest(times: readonly (number | undefined)[]): number | undefined {
	const due = times.filter(time => time !== undefined);
	return due.length ? Math.min(...due) : undefined;
}

function projection(entry: OutboxEntry, value: unknown, now: number): Projection | undefined {
	if (value === undefined) return undefined;
	const document = JSON.stringify(value);
	const common = { id: entry.id, repositoryId: entry.repositoryId, revision: entry.revision, document };
	if (entry.entity !== 'execution') return { ...common, entity: entry.entity, updatedAt: now };
	const parsed = safeDecode(projectedExecution, value);
	if (!parsed.success) return undefined;
	return { ...common, entity: 'execution', state: parsed.data.state, updatedAt: parsed.data.updatedAt };
}

export class Journal {
	private revision: number | undefined;
	private readonly sequence = Semaphore.makeUnsafe(1);
	private readonly draining = Semaphore.makeUnsafe(1);
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly layout: JournalLayout,
	) {}
	private keyOf(ref: Pick<EntityRef, 'entity' | 'id'>): string {
		return Keyspace.key(this.layout.entities[ref.entity], ref.id);
	}
	private outboxKey(revision: number): string {
		return Keyspace.key(this.layout.outbox, String(revision).padStart(16, '0'));
	}
	private next(): Effect.Effect<number, DomainError> {
		return Semaphore.withPermit(
			this.sequence,
			Effect.gen({ self: this }, function*() {
				const current = this.revision
					?? (yield* fromPromise((): Promise<unknown> => this.storage.get(this.layout.sequence.key)).pipe(
						Effect.flatMap(value => fromSync(() => this.layout.sequence.decode(value ?? 0))),
					));
				this.revision = current + 1;
				return this.revision;
			}),
		);
	}
	commit(
		entries: readonly [Committed, ...Committed[]],
		extra: readonly Write[] = [],
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const writes: Record<string, unknown>[] = [];
			let revision = 0;
			for (const { value, ...ref } of entries) {
				revision = yield* this.next();
				writes.push({ [this.keyOf(ref)]: value, [this.outboxKey(revision)]: { ...ref, revision } });
			}
			const chunks: Record<string, unknown>[] = [{
				...Object.fromEntries(extra.map(write => [write.key, write.value])),
				[this.layout.sequence.key]: revision,
			}];
			for (const write of writes) {
				const last = chunks.at(-1);
				if (last && Object.keys(last).length + 2 <= 128) Object.assign(last, write);
				else chunks.push({ ...write });
			}
			const [only] = chunks;
			if (chunks.length === 1 && only) yield* fromPromise(() => this.storage.put(only));
			else {
				yield* fromPromise(() =>
					this.storage.transaction(async transaction => {
						for (const chunk of chunks) await transaction.put(chunk);
					})
				);
			}
		});
	}
	reindex(repositoryId: number): Effect.Effect<number, DomainError> {
		return Effect.gen({ self: this }, function*() {
			let queued = 0;
			for (const entity of projectedEntities) {
				const space = this.layout.entities[entity];
				const keys = [...(yield* fromPromise(() => this.storage.list({ prefix: space.prefix }))).keys()];
				for (let i = 0; i < keys.length; i += batch) {
					const writes: Record<string, unknown> = {};
					for (const key of keys.slice(i, i + batch)) {
						const revision = yield* this.next();
						writes[this.outboxKey(revision)] = { entity, id: Keyspace.id(space, key), repositoryId, revision };
						writes[this.layout.sequence.key] = revision;
					}
					yield* fromPromise(() => this.storage.put(writes));
					queued += keys.slice(i, i + batch).length;
				}
			}
			return queued;
		});
	}
	pending(): Effect.Effect<boolean, DomainError> {
		return fromPromise(() => this.storage.list({ prefix: this.layout.outbox.prefix, limit: 1 })).pipe(
			Effect.map(entries => entries.size > 0),
		);
	}
	drain(project: (rows: Projection[]) => Effect.Effect<void, DomainError>): Effect.Effect<void, DomainError> {
		return Semaphore.withPermit(this.draining, this.flush(project));
	}
	private flush(project: (rows: Projection[]) => Effect.Effect<void, DomainError>): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			for (;;) {
				const entries = yield* fromPromise(() =>
					this.storage.list({ prefix: this.layout.outbox.prefix, limit: batch })
				);
				if (!entries.size) return;
				const latest = new Map<string, OutboxEntry>();
				for (const value of entries.values()) {
					const parsed = safeDecode(outboxEntry, value);
					if (!parsed.success) continue;
					const key = this.keyOf(parsed.data);
					if ((latest.get(key)?.revision ?? 0) < parsed.data.revision) latest.set(key, parsed.data);
				}
				const values = yield* fromPromise(() => this.storage.get([...latest.keys()]));
				const now = clock.currentTimeMillisUnsafe();
				yield* project([...latest].flatMap(([key, entry]) => projection(entry, values.get(key), now) ?? []));
				yield* fromPromise(() => this.storage.delete([...entries.keys()]));
			}
		});
	}
	arm(at: number | undefined): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			if (at === undefined) return;
			const current = yield* fromPromise(() => this.storage.getAlarm());
			if (current === null || current > at) yield* fromPromise(() => this.storage.setAlarm(at));
		});
	}
	schedule(at: number | undefined): Effect.Effect<void, DomainError> {
		return at === undefined ? Effect.void : fromPromise(() => this.storage.setAlarm(at));
	}
}
