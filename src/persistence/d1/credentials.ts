import { z } from 'zod';

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
	constructor(private readonly db: D1Database) {}
	async list(): Promise<ListedCredential[]> {
		const rows = await this.db.prepare(
			'SELECT alias,version,key_id,active,created_at FROM credentials ORDER BY alias,version DESC',
		).all();
		return z.array(listedRow).parse(rows.results);
	}
	async active(): Promise<ActiveCredential[]> {
		const rows = await this.db.prepare(
			'SELECT alias,version,created_at FROM credentials WHERE active=1 ORDER BY alias',
		).all();
		return z.array(activeRow).parse(rows.results);
	}
	async activeVersion(alias: string): Promise<number | undefined> {
		const row = await this.db.prepare('SELECT version FROM credentials WHERE alias=? AND active=1').bind(alias)
			.first();
		return row === null ? undefined : z.object({ version: z.number() }).parse(row).version;
	}
	async sealed(alias: string): Promise<SealedCredential | undefined> {
		const row = await this.db.prepare('SELECT version,key_id,iv,ciphertext FROM credentials WHERE alias=? AND active=1')
			.bind(alias).first();
		return row === null ? undefined : sealedRow.parse(row);
	}
	async nextVersion(alias: string): Promise<number> {
		const row = versionRow.parse(
			await this.db.prepare('SELECT MAX(version) AS version FROM credentials WHERE alias=?').bind(alias).first(),
		);
		return (row.version ?? 0) + 1;
	}
	async store(sealed: Sealed): Promise<void> {
		await this.db.batch([
			this.db.prepare('UPDATE credentials SET active=0 WHERE alias=?').bind(sealed.alias),
			this.db.prepare(
				'INSERT INTO credentials(alias,version,key_id,ciphertext,iv,active,created_at) VALUES(?,?,?,?,?,1,?)',
			).bind(sealed.alias, sealed.version, sealed.keyId, sealed.ciphertext, sealed.iv, Date.now()),
		]);
	}
	async grantDocuments(filter: { alias?: string; repositoryId?: number } = {}): Promise<unknown[]> {
		const query = filter.alias === undefined
			? this.db.prepare('SELECT document FROM grants')
			: filter.repositoryId === undefined
			? this.db.prepare('SELECT document FROM grants WHERE alias=?').bind(filter.alias)
			: this.db.prepare('SELECT document FROM grants WHERE alias=? AND repository_id=?').bind(
				filter.alias,
				filter.repositoryId,
			);
		return z.array(documentRow).parse((await query.all()).results).map(row => JSON.parse(row.document));
	}
	async hasGrant(id: string): Promise<boolean> {
		return await this.db.prepare('SELECT id FROM grants WHERE id=?').bind(id).first() !== null;
	}
	async putGrant(grant: { id: string; alias: string; repositoryId: number }): Promise<void> {
		await this.db.prepare(
			'INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,repository_id=excluded.repository_id,document=excluded.document',
		).bind(grant.id, grant.alias, grant.repositoryId, JSON.stringify(grant)).run();
	}
	async deleteGrant(id: string): Promise<void> {
		await this.db.prepare('DELETE FROM grants WHERE id=?').bind(id).run();
	}
	async deliveries(): Promise<DeliveryRow[]> {
		const rows = await this.db.prepare('SELECT grant_id,version,state,updated_at FROM secret_deliveries').all();
		return z.array(deliveryRow).parse(rows.results);
	}
	async recordDelivery(grantId: string, version: number, state: string): Promise<void> {
		await this.db.prepare(
			'INSERT INTO secret_deliveries(grant_id,version,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(grant_id,version) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
		).bind(grantId, version, state, Date.now()).run();
	}
}
