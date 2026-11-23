import { Effect } from 'effect';
import type { Enrollment, RepositoryRow } from '@/discovery/adapters/d1/repository-rows.ts';
import {
	decodeEnrollment,
	decodeRepository,
	encodeAccess,
	enrollmentColumns,
	enrollmentRow,
	repositoryColumns,
	repositoryRow,
} from '@/discovery/adapters/d1/repository-rows.ts';
import { encodeRepository, identifyRepository } from '@/discovery/repositories/codec-v1.ts';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import type { Access, RepositoryDiscovery } from '@/domain/repository';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { Readable } from '@/kernel/errors/decoding.ts';
import { readableValues, readEach } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeSync, mutableArray } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

export interface UnreadableRepository {
	kind: 'unreadable';
	id: number;
	name: string;
	error: string;
}
function discoveryDocument(discovery: RepositoryDiscovery): Effect.Effect<string, DomainError> {
	const repository = { ...discovery, access: { kind: 'active' as const } };
	return fromSync(() => JSON.stringify(encodeRepository(identifyRepository(encodeRepository(repository)))));
}

export class RepositoryStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	get(id: number): Effect.Effect<RepositoryRecord | undefined, DomainError> {
		return this.sql.first(`SELECT ${repositoryColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeRepository(decodeSync(repositoryRow, row))) : Effect.undefined),
		);
	}
	private rows(): Effect.Effect<RepositoryRow[], DomainError> {
		return this.sql.all(
			`SELECT ${repositoryColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => parse(mutableArray(repositoryRow), rows)));
	}
	all(): Effect.Effect<RepositoryRecord[], DomainError> {
		return this.rows().pipe(Effect.flatMap(rows => fromSync(() => rows.map(decodeRepository))));
	}
	enrollment(id: number): Effect.Effect<Enrollment | undefined, DomainError> {
		return this.sql.first(`SELECT ${enrollmentColumns} FROM repositories WHERE id=?`, id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeEnrollment(decodeSync(enrollmentRow, row))) : Effect.undefined),
		);
	}
	enrollments(): Effect.Effect<Enrollment[], DomainError> {
		return this.sql.all(
			`SELECT ${enrollmentColumns} FROM repositories ORDER BY COALESCE(added_at, updated_at) DESC, name`,
		).pipe(Effect.flatMap(rows => fromSync(() => decodeSync(mutableArray(enrollmentRow), rows).map(decodeEnrollment))));
	}
	readable(): Effect.Effect<RepositoryRecord[], DomainError> {
		return this.read().pipe(
			Effect.map(readableValues),
		);
	}
	read(): Effect.Effect<(Readable<RepositoryRecord> | UnreadableRepository)[], DomainError> {
		return this.rows().pipe(
			Effect.map(rows =>
				readEach(rows, decodeRepository, (row, error): UnreadableRepository => ({
					kind: 'unreadable',
					id: row.id,
					name: row.name,
					error,
				}))
			),
		);
	}
	saveDiscovery(
		discovery: RepositoryDiscovery,
	): Effect.Effect<{ repository: RepositoryRecord; document: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const document = yield* discoveryDocument(discovery);
			const row = yield* this.sql.first(
				`INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at RETURNING ${repositoryColumns}`,
				discovery.id,
				discovery.name,
				document,
				discovery.updatedAt,
				discovery.updatedAt,
			);
			return { repository: yield* fromSync(() => decodeRepository(decodeSync(repositoryRow, row))), document };
		});
	}
	replaceDiscovery(document: string, discovery: RepositoryDiscovery): Effect.Effect<void, DomainError> {
		return discoveryDocument(discovery).pipe(
			Effect.flatMap(next =>
				this.sql.run('UPDATE repositories SET document=? WHERE id=? AND document=?', next, discovery.id, document)
			),
			Effect.asVoid,
		);
	}
	setAccess(id: number, access: Access): Effect.Effect<boolean, DomainError> {
		const [state, since] = encodeAccess(access);
		return this.sql.run(
			"UPDATE repositories SET access=?1, suspended_at=CASE WHEN ?1='active' THEN NULL WHEN access='suspended' THEN suspended_at ELSE ?2 END WHERE id=?3 AND access<>?1",
			state,
			since,
			id,
		).pipe(Effect.map(result => result.meta.changes > 0));
	}
}
