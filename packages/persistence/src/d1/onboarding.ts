import { Effect } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { optionalColumn, sql, upsertDocument } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';

export class OnboardingStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	document(repositoryId: number): Effect.Effect<string | undefined, DomainError> {
		return this.sql.first('SELECT document FROM onboarding WHERE repository_id=?', repositoryId).pipe(
			Effect.flatMap(optionalColumn(documentRow, row => row.document)),
		);
	}
	save(repositoryId: number, document: unknown): Effect.Effect<void, DomainError> {
		return upsertDocument(this.sql, 'onboarding', 'repository_id', { repository_id: repositoryId }, document);
	}
}
