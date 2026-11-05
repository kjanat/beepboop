import { Effect } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import { parse, type Sql, type SqlDatabase, sql } from '@/persistence/d1/database';

const subjectRow = z.object({ subject: z.string() });
const sessionRow = z.object({ id: z.string(), created_at: z.number() });
export type CLISessionRow = z.output<typeof sessionRow>;

export class CLISessionStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	subject(hash: string): Effect.Effect<string | undefined, DomainError> {
		return this.sql.first('SELECT subject FROM cli_sessions WHERE id=?', hash).pipe(
			Effect.flatMap(row =>
				row === null ? Effect.undefined : parse(subjectRow, row).pipe(Effect.map(parsed => parsed.subject))
			),
		);
	}
	create(hash: string, subject: string): Effect.Effect<void, DomainError> {
		return this.sql.run('INSERT INTO cli_sessions(id,subject,created_at) VALUES(?,?,?)', hash, subject, Date.now())
			.pipe(Effect.asVoid);
	}
	revoke(hash: string): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM cli_sessions WHERE id=?', hash).pipe(Effect.asVoid);
	}
	revokeAll(): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM cli_sessions').pipe(Effect.asVoid);
	}
	list(): Effect.Effect<CLISessionRow[], DomainError> {
		return this.sql.all('SELECT id,created_at FROM cli_sessions ORDER BY created_at DESC').pipe(
			Effect.flatMap(rows => parse(z.array(sessionRow), rows)),
		);
	}
}
