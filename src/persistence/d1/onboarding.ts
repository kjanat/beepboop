import { Effect } from 'effect';
import { documentRow } from '@/automation/schemas';
import type { DomainError } from '@/contract/errors';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

export class OnboardingStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	document(repositoryId: number): Effect.Effect<string | undefined, DomainError> {
		return this.sql.first('SELECT document FROM onboarding WHERE repository_id=?', repositoryId).pipe(
			Effect.flatMap(row =>
				row === null ? Effect.undefined : parse(documentRow, row).pipe(Effect.map(parsed => parsed.document))
			),
		);
	}
	save(repositoryId: number, document: unknown): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO onboarding(repository_id,document) VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document',
			repositoryId,
			JSON.stringify(document),
		).pipe(Effect.asVoid);
	}
}
