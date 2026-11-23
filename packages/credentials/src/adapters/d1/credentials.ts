import { Effect, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { optionalColumn, parse, sql } from '@/persistence/d1/database';

const versionRow = mutableStruct({ version: Schema.NullOr(Schema.Finite) });
const sealedRow = mutableStruct({
	version: Schema.Finite,
	key_id: Schema.String,
	iv: Schema.String,
	ciphertext: Schema.String,
});
const listedRow = mutableStruct({
	alias: Schema.String,
	version: Schema.Finite,
	key_id: Schema.String,
	active: Schema.Finite,
	created_at: Schema.Finite,
});
const activeRow = mutableStruct({ alias: Schema.String, version: Schema.Finite, created_at: Schema.Finite });

export type SealedCredential = Decoded<typeof sealedRow>;
export type ListedCredential = Decoded<typeof listedRow>;
export type ActiveCredential = Decoded<typeof activeRow>;

export interface Sealed {
	alias: string;
	version: number;
	keyId: string;
	ciphertext: string;
	iv: string;
}

export class CredentialStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase | Sql) {
		this.sql = sql(db);
	}
	list(): Effect.Effect<ListedCredential[], DomainError> {
		return this.sql.all('SELECT alias,version,key_id,active,created_at FROM credentials ORDER BY alias,version DESC')
			.pipe(Effect.flatMap(rows => parse(mutableArray(listedRow), rows)));
	}
	active(): Effect.Effect<ActiveCredential[], DomainError> {
		return this.sql.all('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias').pipe(
			Effect.flatMap(rows => parse(mutableArray(activeRow), rows)),
		);
	}
	activeVersion(alias: string): Effect.Effect<number | undefined, DomainError> {
		return this.sql.first('SELECT version FROM credentials WHERE alias=? AND active=1', alias).pipe(
			Effect.flatMap(optionalColumn(mutableStruct({ version: Schema.Finite }), row => row.version)),
		);
	}
	sealed(alias: string): Effect.Effect<SealedCredential | undefined, DomainError> {
		return this.sql.first('SELECT version,key_id,iv,ciphertext FROM credentials WHERE alias=? AND active=1', alias)
			.pipe(Effect.flatMap(row => row === null ? Effect.undefined : parse(sealedRow, row)));
	}
	nextVersion(alias: string): Effect.Effect<number, DomainError> {
		return this.sql.first('SELECT MAX(version) AS version FROM credentials WHERE alias=?', alias).pipe(
			Effect.flatMap(row => parse(versionRow, row)),
			Effect.map(row => (row.version ?? 0) + 1),
		);
	}
	store(sealed: Sealed): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.batch([
				this.sql.statement('UPDATE credentials SET active=0 WHERE alias=?', sealed.alias),
				this.sql.statement(
					'INSERT INTO credentials(alias,version,key_id,ciphertext,iv,active,created_at) VALUES(?,?,?,?,?,1,?)',
					sealed.alias,
					sealed.version,
					sealed.keyId,
					sealed.ciphertext,
					sealed.iv,
					clock.currentTimeMillisUnsafe(),
				),
			]).pipe(Effect.asVoid);
		});
	}
}
