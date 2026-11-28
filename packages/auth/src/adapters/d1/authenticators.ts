import type { WebAuthnCredential } from '@simplewebauthn/server';
import { Effect, Schema } from 'effect';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase, SqlResult } from '@/persistence/d1/database';
import { replaceDocument, sql } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';

export interface SavedCredential {
	label?: string;
	id: string;
	publicKey: string;
	counter: number;
	transports?: WebAuthnCredential['transports'];
}
const savedCredential: Schema.Codec<SavedCredential, unknown> = mutableStruct({
	label: Schema.optional(Schema.String),
	id: Schema.String,
	publicKey: Schema.String,
	counter: Schema.Finite,
	transports: Schema.optional(mutableArray(Schema.String)),
});
export interface StoredCredential {
	document: string;
	credential: SavedCredential;
}
type Written = Effect.Effect<SqlResult, DomainError>;

export class AuthenticatorStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	saved(subject: string): Effect.Effect<StoredCredential[], DomainError> {
		return this.sql.all('SELECT document FROM authenticators WHERE subject=?', subject).pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					rows.map(row => {
						const { document } = decodeSync(documentRow, row);
						return { document, credential: decodeSync(savedCredential, JSON.parse(document)) };
					})
				)
			),
		);
	}
	enrollInitial(subject: string, credential: SavedCredential): Written {
		return this.sql.run(
			'INSERT INTO authenticators(id,subject,document) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM authenticators WHERE subject=?)',
			credential.id,
			subject,
			JSON.stringify(credential),
			subject,
		);
	}
	enroll(subject: string, credential: SavedCredential): Written {
		return this.sql.run(
			'INSERT INTO authenticators(id,subject,document) VALUES(?,?,?)',
			credential.id,
			subject,
			JSON.stringify(credential),
		);
	}
	replace(id: string, document: string, next: SavedCredential): Written {
		return replaceDocument(this.sql, 'authenticators', 'id', id, document, next);
	}
	remove(subject: string, id: string): Written {
		return this.sql.run(
			'DELETE FROM authenticators WHERE subject=? AND id=? AND (SELECT count(*) FROM authenticators WHERE subject=?)>1',
			subject,
			id,
			subject,
		);
	}
}
