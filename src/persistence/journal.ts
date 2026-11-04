import { z } from 'zod';
import { type ProjectedEntity, projectedEntities } from '@/contract/changes';
import type { Projection } from '@/persistence/d1/projection';

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
const counter = z.number().int().nonnegative();
const outboxEntry = z.object({
	entity: z.enum(projectedEntities),
	id: z.string(),
	repositoryId: z.number().int().positive(),
	revision: z.number().int().positive(),
});
type OutboxEntry = z.output<typeof outboxEntry>;
const projectedExecution = z.looseObject({ state: z.string(), updatedAt: z.number() });

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
	const parsed = projectedExecution.safeParse(value);
	if (!parsed.success) return undefined;
	return { ...common, entity: 'execution', state: parsed.data.state, updatedAt: parsed.data.updatedAt };
}

export class Journal {
	private sequence: Promise<number> | undefined;
	private draining: Promise<void> | undefined;
	constructor(private readonly storage: DurableObjectStorage) {}
	private next(): Promise<number> {
		const next = (this.sequence ?? this.storage.get('journal:seq').then(value => counter.parse(value ?? 0)))
			.then(revision => revision + 1);
		this.sequence = next.catch(error => {
			this.sequence = undefined;
			throw error;
		});
		return next;
	}
	async commit(entries: readonly [Committed, ...Committed[]], extra: Record<string, unknown> = {}): Promise<void> {
		const writes: Record<string, unknown>[] = [];
		let revision = 0;
		for (const { value, ...ref } of entries) {
			revision = await this.next();
			writes.push({ [keyOf(ref)]: value, [outboxKey(revision)]: { ...ref, revision } });
		}
		const chunks: Record<string, unknown>[] = [{ ...extra, 'journal:seq': revision }];
		for (const write of writes) {
			const last = chunks.at(-1);
			if (last && Object.keys(last).length + 2 <= 128) Object.assign(last, write);
			else chunks.push({ ...write });
		}
		if (chunks.length === 1 && chunks[0]) await this.storage.put(chunks[0]);
		else {
			await this.storage.transaction(async transaction => {
				for (const chunk of chunks) await transaction.put(chunk);
			});
		}
	}
	async reindex(repositoryId: number): Promise<number> {
		let queued = 0;
		for (const entity of projectedEntities) {
			const keys = [...(await this.storage.list({ prefix: prefixes[entity] })).keys()];
			for (let i = 0; i < keys.length; i += batch) {
				const writes: Record<string, unknown> = {};
				for (const key of keys.slice(i, i + batch)) {
					const revision = await this.next();
					writes[outboxKey(revision)] = { entity, id: key.slice(prefixes[entity].length), repositoryId, revision };
					writes['journal:seq'] = revision;
				}
				await this.storage.put(writes);
				queued += keys.slice(i, i + batch).length;
			}
		}
		return queued;
	}
	async pending(): Promise<boolean> {
		return (await this.storage.list({ prefix: 'outbox:', limit: 1 })).size > 0;
	}
	drain(project: (rows: Projection[]) => Promise<void>): Promise<void> {
		this.draining ??= this.flush(project).finally(() => {
			this.draining = undefined;
		});
		return this.draining;
	}
	private async flush(project: (rows: Projection[]) => Promise<void>): Promise<void> {
		for (;;) {
			const entries = await this.storage.list({ prefix: 'outbox:', limit: batch });
			if (!entries.size) return;
			const latest = new Map<string, OutboxEntry>();
			for (const value of entries.values()) {
				const parsed = outboxEntry.safeParse(value);
				if (!parsed.success) continue;
				const key = keyOf(parsed.data);
				if ((latest.get(key)?.revision ?? 0) < parsed.data.revision) latest.set(key, parsed.data);
			}
			const values = await this.storage.get([...latest.keys()]);
			const now = Date.now();
			await project(
				[...latest].flatMap(([key, entry]) => projection(entry, values.get(key), now) ?? []),
			);
			await this.storage.delete([...entries.keys()]);
		}
	}
	async arm(at: number | undefined): Promise<void> {
		if (at === undefined) return;
		const current = await this.storage.getAlarm();
		if (current === null || current > at) await this.storage.setAlarm(at);
	}
	async schedule(at: number | undefined): Promise<void> {
		if (at !== undefined) await this.storage.setAlarm(at);
	}
}
