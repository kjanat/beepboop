import { Clock, Effect, Schema, Semaphore } from 'effect';
import type { ProjectedEntity } from '@/contract/changes';
import { projectedEntities } from '@/contract/changes';
import type { DomainError } from '@/contract/errors';
import { fromPromise, fromSync } from '@/failure';
import type { Projection } from '@/persistence/d1/projection';
import type { Decoded } from '@/schema';
import { decodeSync, looseStruct, mutableStruct, safeDecode } from '@/schema';

export interface EntityRef {
	entity: ProjectedEntity;
	id: string;
	repositoryId: number;
}
export interface Committed extends EntityRef {
	value: unknown;
}

const batch = 64;
const prefixes = {
	execution: 'execution:',
	'release-set': 'release-set:',
	release: 'release:',
} as const satisfies Record<ProjectedEntity, string>;
const counter = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0));
const outboxEntry = mutableStruct({
	entity: Schema.Literals(projectedEntities),
	id: Schema.String,
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	revision: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
});
type OutboxEntry = Decoded<typeof outboxEntry>;
const projectedExecution = looseStruct({ state: Schema.String, updatedAt: Schema.Finite });

export function keyOf(ref: Pick<EntityRef, 'entity' | 'id'>): string {
	return `${prefixes[ref.entity]}${ref.id}`;
}
function outboxKey(revision: number): string {
	return `outbox:${String(revision).padStart(16, '0')}`;
}
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
	constructor(private readonly storage: DurableObjectStorage) {}
	private next(): Effect.Effect<number, DomainError> {
		return Semaphore.withPermit(
			this.sequence,
			Effect.gen({ self: this }, function*() {
				const current = this.revision
					?? (yield* fromPromise(() => this.storage.get('journal:seq')).pipe(
						Effect.flatMap(value => fromSync(() => decodeSync(counter, value ?? 0))),
					));
				this.revision = current + 1;
				return this.revision;
			}),
		);
	}
	commit(
		entries: readonly [Committed, ...Committed[]],
		extra: Record<string, unknown> = {},
	): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const writes: Record<string, unknown>[] = [];
			let revision = 0;
			for (const { value, ...ref } of entries) {
				revision = yield* this.next();
				writes.push({ [keyOf(ref)]: value, [outboxKey(revision)]: { ...ref, revision } });
			}
			const chunks: Record<string, unknown>[] = [{ ...extra, 'journal:seq': revision }];
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
				const keys = [...(yield* fromPromise(() => this.storage.list({ prefix: prefixes[entity] }))).keys()];
				for (let i = 0; i < keys.length; i += batch) {
					const writes: Record<string, unknown> = {};
					for (const key of keys.slice(i, i + batch)) {
						const revision = yield* this.next();
						writes[outboxKey(revision)] = { entity, id: key.slice(prefixes[entity].length), repositoryId, revision };
						writes['journal:seq'] = revision;
					}
					yield* fromPromise(() => this.storage.put(writes));
					queued += keys.slice(i, i + batch).length;
				}
			}
			return queued;
		});
	}
	pending(): Effect.Effect<boolean, DomainError> {
		return fromPromise(() => this.storage.list({ prefix: 'outbox:', limit: 1 })).pipe(
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
				const entries = yield* fromPromise(() => this.storage.list({ prefix: 'outbox:', limit: batch }));
				if (!entries.size) return;
				const latest = new Map<string, OutboxEntry>();
				for (const value of entries.values()) {
					const parsed = safeDecode(outboxEntry, value);
					if (!parsed.success) continue;
					const key = keyOf(parsed.data);
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
