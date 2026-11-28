import { Effect, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { optionalColumn, parse, sql } from '@/persistence/d1/database';

const subjectRow = mutableStruct({ subject: Schema.String });
const sessionRow = mutableStruct({ id: Schema.String, created_at: Schema.Finite });
export interface CLISession {
	readonly id: string;
	readonly createdAt: number;
}

export class CLISessionStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	subject(hash: string): Effect.Effect<string | undefined, DomainError> {
		return this.sql.first('SELECT subject FROM cli_sessions WHERE id=?', hash).pipe(
			Effect.flatMap(optionalColumn(subjectRow, row => row.subject)),
		);
	}
	create(hash: string, subject: string): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				'INSERT INTO cli_sessions(id,subject,created_at) VALUES(?,?,?)',
				hash,
				subject,
				clock.currentTimeMillisUnsafe(),
			)
				.pipe(Effect.asVoid);
		});
	}
	revoke(hash: string): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM cli_sessions WHERE id=?', hash).pipe(Effect.asVoid);
	}
	revokeAll(): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM cli_sessions').pipe(Effect.asVoid);
	}
	list(): Effect.Effect<CLISession[], DomainError> {
		return this.sql.all('SELECT id,created_at FROM cli_sessions ORDER BY created_at DESC').pipe(
			Effect.flatMap(rows => parse(mutableArray(sessionRow), rows)),
			Effect.map(rows => rows.map(row => ({ id: row.id, createdAt: row.created_at }))),
		);
	}
}
