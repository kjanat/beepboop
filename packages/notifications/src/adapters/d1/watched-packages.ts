import { Effect, Schema } from 'effect';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import { watchedRegistries } from '@/domain/catalog.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql } from '@/persistence/d1/database';
import { parse } from '@/persistence/d1/database';

const watchedRow = mutableStruct({
	registry: Schema.Literals(watchedRegistries),
	name: Schema.String,
	manual: Schema.Finite,
	version: Schema.NullOr(Schema.String),
	checked_at: Schema.NullOr(Schema.Finite),
	changed_at: Schema.NullOr(Schema.Finite),
	error: Schema.NullOr(Schema.String),
	awaiting_release: Schema.Finite,
});
export type WatchedRow = Decoded<typeof watchedRow>;

export class WatchedPackages {
	constructor(private readonly sql: Sql) {}

	list(): Effect.Effect<WatchedRow[], DomainError> {
		return this.sql.all('SELECT * FROM watched_packages ORDER BY registry, name').pipe(
			Effect.flatMap(rows => parse(mutableArray(watchedRow), rows)),
		);
	}

	insert(
		registry: WatchedRegistry,
		name: string,
		manual: boolean,
		addedAt: number,
	): Effect.Effect<boolean, DomainError> {
		return this.sql.run(
			'INSERT OR IGNORE INTO watched_packages (registry, name, manual, added_at) VALUES (?, ?, ?, ?)',
			registry,
			name,
			Number(manual),
			addedAt,
		).pipe(Effect.map(inserted => inserted.meta.changes > 0));
	}

	markManual(registry: WatchedRegistry, name: string): Effect.Effect<void, DomainError> {
		return this.sql.run('UPDATE watched_packages SET manual = 1 WHERE registry = ? AND name = ?', registry, name).pipe(
			Effect.asVoid,
		);
	}

	clearManual(registry: WatchedRegistry, name: string): Effect.Effect<void, DomainError> {
		return this.sql.run('UPDATE watched_packages SET manual = 0 WHERE registry = ? AND name = ?', registry, name).pipe(
			Effect.asVoid,
		);
	}

	unpublished(
		registry: WatchedRegistry,
		name: string,
		checkedAt: number,
		error: string,
		missing: boolean,
	): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'UPDATE watched_packages SET checked_at = ?, error = ?, awaiting_release = CASE WHEN ? AND version IS NULL THEN 1 ELSE awaiting_release END WHERE registry = ? AND name = ?',
			checkedAt,
			error,
			Number(missing),
			registry,
			name,
		).pipe(Effect.asVoid);
	}

	published(
		registry: WatchedRegistry,
		name: string,
		version: string,
		checkedAt: number,
	): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'UPDATE watched_packages SET version = ?, checked_at = ?, error = NULL, awaiting_release = 0, changed_at = CASE WHEN version IS NOT ? THEN ? ELSE changed_at END WHERE registry = ? AND name = ?',
			version,
			checkedAt,
			version,
			checkedAt,
			registry,
			name,
		).pipe(Effect.asVoid);
	}
}
