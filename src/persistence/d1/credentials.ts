import { Effect } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import { fromSync } from '@/failure';
import { parse, type Sql, type SqlDatabase, sql } from '@/persistence/d1/database';

const documentRow = z.object({ document: z.string() });
const versionRow = z.object({ version: z.number().nullable() });
const sealedRow = z.object({ version: z.number(), key_id: z.string(), iv: z.string(), ciphertext: z.string() });
const listedRow = z.object({
	alias: z.string(),
	version: z.number(),
	key_id: z.string(),
	active: z.number(),
	created_at: z.number(),
});
const activeRow = z.object({ alias: z.string(), version: z.number(), created_at: z.number() });
const deliveryRow = z.object({ grant_id: z.string(), version: z.number(), state: z.string(), updated_at: z.number() });

export type SealedCredential = z.output<typeof sealedRow>;
export type ListedCredential = z.output<typeof listedRow>;
export type ActiveCredential = z.output<typeof activeRow>;
export type DeliveryRow = z.output<typeof deliveryRow>;

export interface Sealed {
	alias: string;
	version: number;
	keyId: string;
	ciphertext: string;
	iv: string;
}

export class CredentialStore {
	private readonly sql: Sql;
	constructor(db: SqlDatabase) {
		this.sql = sql(db);
	}
	list(): Effect.Effect<ListedCredential[], DomainError> {
		return this.sql.all('SELECT alias,version,key_id,active,created_at FROM credentials ORDER BY alias,version DESC')
			.pipe(Effect.flatMap(rows => parse(z.array(listedRow), rows)));
	}
	active(): Effect.Effect<ActiveCredential[], DomainError> {
		return this.sql.all('SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias').pipe(
			Effect.flatMap(rows => parse(z.array(activeRow), rows)),
		);
	}
	activeVersion(alias: string): Effect.Effect<number | undefined, DomainError> {
		return this.sql.first('SELECT version FROM credentials WHERE alias=? AND active=1', alias).pipe(
			Effect.flatMap(row =>
				row === null
					? Effect.undefined
					: parse(z.object({ version: z.number() }), row).pipe(Effect.map(parsed => parsed.version))
			),
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
		return this.sql.batch([
			this.sql.statement('UPDATE credentials SET active=0 WHERE alias=?', sealed.alias),
			this.sql.statement(
				'INSERT INTO credentials(alias,version,key_id,ciphertext,iv,active,created_at) VALUES(?,?,?,?,?,1,?)',
				sealed.alias,
				sealed.version,
				sealed.keyId,
				sealed.ciphertext,
				sealed.iv,
				Date.now(),
			),
		]).pipe(Effect.asVoid);
	}
	grantDocuments(filter: { alias?: string; repositoryId?: number } = {}): Effect.Effect<unknown[], DomainError> {
		const rows = filter.alias === undefined
			? this.sql.all('SELECT document FROM grants')
			: filter.repositoryId === undefined
			? this.sql.all('SELECT document FROM grants WHERE alias=?', filter.alias)
			: this.sql.all(
				'SELECT document FROM grants WHERE alias=? AND repository_id=?',
				filter.alias,
				filter.repositoryId,
			);
		return rows.pipe(
			Effect.flatMap(rows => parse(z.array(documentRow), rows)),
			Effect.flatMap(rows => fromSync(() => rows.map((row): unknown => JSON.parse(row.document)))),
		);
	}
	hasGrant(id: string): Effect.Effect<boolean, DomainError> {
		return this.sql.first('SELECT id FROM grants WHERE id=?', id).pipe(Effect.map(row => row !== null));
	}
	putGrant(grant: { id: string; alias: string; repositoryId: number }): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,repository_id=excluded.repository_id,document=excluded.document',
			grant.id,
			grant.alias,
			grant.repositoryId,
			JSON.stringify(grant),
		).pipe(Effect.asVoid);
	}
	deleteGrant(id: string): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM grants WHERE id=?', id).pipe(Effect.asVoid);
	}
	deliveries(): Effect.Effect<DeliveryRow[], DomainError> {
		return this.sql.all('SELECT grant_id,version,state,updated_at FROM secret_deliveries').pipe(
			Effect.flatMap(rows => parse(z.array(deliveryRow), rows)),
		);
	}
	recordDelivery(grantId: string, version: number, state: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO secret_deliveries(grant_id,version,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(grant_id,version) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
			grantId,
			version,
			state,
			Date.now(),
		).pipe(Effect.asVoid);
	}
}
