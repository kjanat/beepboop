import { Effect } from 'effect';
import { documentRow } from '@/automation/schemas';
import type { DomainError } from '@/contract/errors';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';

export const sessionKinds = ['login-flow', 'security-challenge', 'elevation', 'cli-approval'] as const;
export type SessionKind = (typeof sessionKinds)[number];

export class SessionStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	open(kind: SessionKind, id: string, document: unknown, lifetime: number): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)',
			id,
			kind,
			JSON.stringify(document),
			Date.now() + lifetime,
		).pipe(Effect.asVoid);
	}
	offer(kind: SessionKind, id: string, document: unknown, lifetime: number): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT OR IGNORE INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)',
			id,
			kind,
			JSON.stringify(document),
			Date.now() + lifetime,
		).pipe(Effect.asVoid);
	}
	take(id: string): Effect.Effect<string | undefined, DomainError> {
		return this.sql.first('DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document', id, Date.now()).pipe(
			Effect.flatMap(row =>
				row === null ? Effect.undefined : parse(documentRow, row).pipe(Effect.map(parsed => parsed.document))
			),
		);
	}
	sweep(): Effect.Effect<number, DomainError> {
		return this.sql.run('DELETE FROM sessions WHERE expires_at<=?', Date.now()).pipe(
			Effect.map(result => result.meta.changes),
		);
	}
}
