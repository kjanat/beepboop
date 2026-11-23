import { Effect } from 'effect';
import type { Grant } from '@/credentials/grant.ts';
import { grantRow, parseGrant } from '@/credentials/grant.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mutableArray } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql, upsertDocument } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';

export class GrantStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	list(filter: { alias?: string; repositoryId?: number } = {}): Effect.Effect<Grant[], DomainError> {
		const rows = filter.alias === undefined
			? filter.repositoryId === undefined
				? this.sql.all('SELECT document FROM grants')
				: this.sql.all('SELECT document FROM grants WHERE repository_id=?', filter.repositoryId)
			: filter.repositoryId === undefined
			? this.sql.all('SELECT document FROM grants WHERE alias=?', filter.alias)
			: this.sql.all(
				'SELECT document FROM grants WHERE alias=? AND repository_id=?',
				filter.alias,
				filter.repositoryId,
			);
		return rows.pipe(
			Effect.flatMap(rows => parse(mutableArray(documentRow), rows)),
			Effect.flatMap(rows => fromSync(() => rows.map((row): unknown => JSON.parse(row.document)))),
			Effect.flatMap(documents => Effect.forEach(documents, parseGrant)),
		);
	}
	has(id: string): Effect.Effect<boolean, DomainError> {
		return this.sql.first('SELECT id FROM grants WHERE id=?', id).pipe(Effect.map(row => row !== null));
	}
	put(grant: Grant): Effect.Effect<void, DomainError> {
		return fromSync(() => grantRow(grant)).pipe(
			Effect.flatMap(row =>
				upsertDocument(
					this.sql,
					'grants',
					'id',
					{ id: row.id, alias: row.alias, repository_id: row.repositoryId },
					row,
				)
			),
		);
	}
	delete(id: string): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM grants WHERE id=?', id).pipe(Effect.asVoid);
	}
}
