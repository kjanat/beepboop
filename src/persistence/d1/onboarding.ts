import { Effect } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import { parse, type Sql, type SqlDatabase, sql } from '@/persistence/d1/database';

const documentRow = z.object({ document: z.string() });

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
