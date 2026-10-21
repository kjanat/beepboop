import { seal } from 'tweetnacl-sealedbox-js';
import { integer, record, text } from '#model';
import { base64, bytes, type WorkflowIdentity } from './auth.ts';
import type { RepositoryGateway } from './github.ts';
import { matchesRef } from './policy.ts';
import type { Store } from './store.ts';

export interface Grant {
	id: string;
	alias: string;
	repositoryId: number;
	repository: string;
	operation: string;
	workflow: string;
	ref: string;
	environment?: string;
	delivery: 'runtime' | 'repository' | 'environment';
	secretName?: string;
}
export function parseGrant(value: unknown): Grant {
	const data = record(value);
	for (const key of Object.keys(data)) {
		if (
			![
				'id',
				'alias',
				'repositoryId',
				'repository',
				'operation',
				'workflow',
				'ref',
				'environment',
				'delivery',
				'secretName',
			].includes(key)
		) {
			throw new Error('Unknown grant field');
		}
	}
	const grant: Grant = {
		id: text(data.id),
		alias: text(data.alias),
		repositoryId: integer(data.repositoryId),
		repository: text(data.repository),
		operation: text(data.operation),
		workflow: text(data.workflow),
		ref: text(data.ref),
		delivery: text(data.delivery) as Grant['delivery'],
		...(data.environment === undefined ? {} : { environment: text(data.environment) }),
		...(data.secretName === undefined ? {} : { secretName: text(data.secretName) }),
	};
	if (
		!/^[\w-]+$/.test(grant.alias)
		|| !/^[\w.-]+\/[\w.-]+$/.test(grant.repository)
		|| !/^[\w-]+\.ya?ml$/.test(grant.workflow)
		|| !grant.ref.startsWith('refs/')
	) {
		throw new Error('Invalid grant');
	}
	if (!['runtime', 'repository', 'environment'].includes(grant.delivery)) {
		throw new Error('Invalid delivery mode');
	}
	if (
		grant.delivery !== 'runtime'
		&& (!grant.secretName || !/^[A-Z_][A-Z0-9_]*$/.test(grant.secretName))
	) {
		throw new Error('Secret name required');
	}
	if (grant.delivery === 'environment' && !grant.environment) {
		throw new Error('Environment required');
	}
	return grant;
}
export class Vault {
	constructor(
		private store: Store,
		private keyring: Record<string, string>,
		private activeKey: string,
	) {}
	private async key(id: string): Promise<CryptoKey> {
		const value = this.keyring[id];
		if (!value) throw new Error('Encryption key unavailable');
		const raw = bytes(value);
		if (raw.length !== 32) throw new Error('Encryption key must be 32 bytes');
		return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
	}
	async replace(alias: string, value: string, actor: string): Promise<number> {
		if (!/^[\w-]{1,64}$/.test(alias) || !value || value.length > 48000) {
			throw new Error('Invalid credential');
		}
		const latest = await this.store.db
			.prepare('SELECT MAX(version) AS version FROM credentials WHERE alias=?')
			.bind(alias)
			.first<{ version: number | null }>();
		const version = (latest?.version ?? 0) + 1,
			iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: new TextEncoder().encode(`${alias}:${version}:${this.activeKey}`),
			},
			await this.key(this.activeKey),
			new TextEncoder().encode(value),
		);
		await this.store.db.batch([
			this.store.db.prepare('UPDATE credentials SET active=0 WHERE alias=?').bind(alias),
			this.store.db
				.prepare('INSERT INTO credentials VALUES(?,?,?,?,?,1,?)')
				.bind(
					alias,
					version,
					this.activeKey,
					base64(new Uint8Array(ciphertext)),
					base64(iv),
					Date.now(),
				),
		]);
		await this.store.audit(actor, 'credential.replace', alias);
		return version;
	}
	async reveal(alias: string, actor: string): Promise<{ value: string; version: number }> {
		const row = await this.store.db
			.prepare('SELECT * FROM credentials WHERE alias=? AND active=1')
			.bind(alias)
			.first<{ version: number; key_id: string; iv: string; ciphertext: string }>();
		if (!row) throw new Error('Credential unavailable');
		const clear = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: bytes(row.iv),
				additionalData: new TextEncoder().encode(`${alias}:${row.version}:${row.key_id}`),
			},
			await this.key(row.key_id),
			bytes(row.ciphertext),
		);
		await this.store.audit(actor, 'credential.access', alias);
		return { value: new TextDecoder().decode(clear), version: row.version };
	}
	async grant(grant: Grant, actor: string): Promise<void> {
		await this.store.db
			.prepare(
				'INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,repository_id=excluded.repository_id,document=excluded.document',
			)
			.bind(grant.id, grant.alias, grant.repositoryId, JSON.stringify(grant))
			.run();
		await this.store.audit(actor, 'credential.grant', grant.id);
	}
	async revoke(id: string, actor: string): Promise<void> {
		await this.store.db.prepare('DELETE FROM grants WHERE id=?').bind(id).run();
		await this.store.audit(actor, 'credential.revoke', id);
	}
	async runtime(alias: string, operation: string, identity: WorkflowIdentity): Promise<string> {
		const rows = await this.store.db
			.prepare('SELECT document FROM grants WHERE alias=? AND repository_id=?')
			.bind(alias, identity.repositoryId)
			.all<{ document: string }>();
		const allowed = rows.results
			.map((r) => JSON.parse(r.document) as Grant)
			.some(
				(g) =>
					g.delivery === 'runtime'
					&& g.operation === operation
					&& g.repository === identity.repository
					&& matchesRef(g.ref, identity.ref)
					&& g.environment === identity.environment
					&& identity.workflowRef
						=== `${identity.repository}/.github/workflows/${g.workflow}@${identity.ref}`,
			);
		if (!allowed) throw new Error('Credential grant denied');
		return (
			await this.reveal(alias, `run:${identity.repositoryId}:${identity.runId}:${identity.attempt}`)
		).value;
	}
	async synchronize(
		alias: string,
		gateway: RepositoryGateway,
		actor: string,
	): Promise<{ id: string; state: string }[]> {
		const rows = await this.store.db
			.prepare('SELECT document FROM grants WHERE alias=?')
			.bind(alias)
			.all<{ document: string }>();
		const secret = await this.reveal(alias, actor),
			outcomes: { id: string; state: string }[] = [];
		for (
			const grant of rows.results
				.map((row) => JSON.parse(row.document) as Grant)
				.filter((g) => g.delivery !== 'runtime')
		) {
			let state = 'failed';
			try {
				const permissions: Record<string, 'read' | 'write'> = grant.delivery === 'environment'
					? { environments: 'write', contents: 'read' }
					: { secrets: 'write', contents: 'read' };
				const token = await gateway.token(grant.repository, grant.repositoryId, permissions);
				const path = grant.delivery === 'environment'
					? `/repositories/${grant.repositoryId}/environments/${
						encodeURIComponent(
							grant.environment as string,
						)
					}/secrets`
					: `/repos/${grant.repository}/actions/secrets`;
				const publicKey = record(await gateway.call(`${path}/public-key`, token));
				const encrypted = seal(new TextEncoder().encode(secret.value), bytes(text(publicKey.key)));
				await gateway.call(`${path}/${grant.secretName}`, token, 'PUT', {
					encrypted_value: base64(encrypted),
					key_id: text(publicKey.key_id),
				});
				state = 'succeeded';
			} catch {
				/* Record only the destination outcome; API responses can contain sensitive details. */
			}
			await this.store.db
				.prepare(
					'INSERT INTO secret_deliveries VALUES(?,?,?,?) ON CONFLICT(grant_id,version) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
				)
				.bind(grant.id, secret.version, state, Date.now())
				.run();
			outcomes.push({ id: grant.id, state });
		}
		return outcomes;
	}
}
