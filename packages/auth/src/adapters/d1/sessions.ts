import { Effect, Result, Schema } from 'effect';
import type { SessionDocument, SessionKind } from '@/auth/session-documents.ts';
import { sessionDocuments } from '@/auth/session-documents.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { optionalColumn, sql } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';

export class SessionStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	open<K extends SessionKind>(
		kind: K,
		id: string,
		document: SessionDocument<K>,
		lifetime: number,
	): Effect.Effect<void, DomainError> {
		return this.insert('INSERT', kind, id, document, lifetime);
	}
	offer<K extends SessionKind>(
		kind: K,
		id: string,
		document: SessionDocument<K>,
		lifetime: number,
	): Effect.Effect<void, DomainError> {
		return this.insert('INSERT OR IGNORE', kind, id, document, lifetime);
	}
	private insert<K extends SessionKind>(
		verb: 'INSERT' | 'INSERT OR IGNORE',
		kind: K,
		id: string,
		document: SessionDocument<K>,
		lifetime: number,
	): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				`${verb} INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)`,
				id,
				kind,
				JSON.stringify(document),
				clock.currentTimeMillisUnsafe() + lifetime,
			).pipe(Effect.asVoid);
		});
	}
	take<K extends SessionKind>(kind: K, id: string): Effect.Effect<SessionDocument<K> | undefined, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.first(
				'DELETE FROM sessions WHERE id=? AND (kind=? OR kind IS NULL) AND expires_at>? RETURNING document',
				id,
				kind,
				clock.currentTimeMillisUnsafe(),
			).pipe(
				Effect.flatMap(optionalColumn(documentRow, row => row.document)),
				Effect.map(document => {
					if (document === undefined) return undefined;
					const decoded = Result.try((): unknown => JSON.parse(document)).pipe(
						Result.flatMap(Schema.decodeUnknownResult(sessionDocuments[kind])),
					);
					return Result.getOrUndefined(decoded);
				}),
			);
		});
	}
	sweep(): Effect.Effect<number, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run('DELETE FROM sessions WHERE expires_at<=?', clock.currentTimeMillisUnsafe()).pipe(
				Effect.map(result => result.meta.changes),
			);
		});
	}
}
