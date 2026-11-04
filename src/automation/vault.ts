import { seal } from 'tweetnacl-sealedbox-js';
import { z } from 'zod';
import { base64, bytes, type WorkflowIdentity } from '@/automation/auth';
import type { RepositoryGateway } from '@/automation/github';
import { matchesRef } from '@/automation/policy';
import type { Store } from '@/automation/store';
import { forbidden, invalid, notFound } from '@/contract/errors';
import { credentialAliasPattern, githubSecretNamePattern } from '@/contract/ids';
import { record, text } from '@/model';
import type { CredentialStore } from '@/persistence/d1/credentials';

interface GrantFields {
	id: string;
	alias: string;
	repositoryId: number;
	repository: string;
	operation: string;
	workflow: string;
	ref: string;
	environment?: string;
	secretName?: string;
}
export type Grant =
	| (GrantFields & { delivery: 'runtime' })
	| (GrantFields & { delivery: 'repository'; secretName: string })
	| (GrantFields & { delivery: 'environment'; environment: string; secretName: string });
const nonempty = z.string().min(1);
const grantFields = {
	id: nonempty,
	alias: z.string().regex(/^[\w-]+$/),
	repositoryId: z.number().int().positive(),
	repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	operation: nonempty,
	workflow: z.string().regex(/^[\w-]+\.ya?ml$/),
	ref: z.string().startsWith('refs/'),
};
const secretName = z.string().regex(githubSecretNamePattern, 'Secret name required');
const grantSchema = z.discriminatedUnion('delivery', [
	z.strictObject({
		...grantFields,
		delivery: z.literal('runtime'),
		environment: nonempty.optional(),
		secretName: nonempty.optional(),
	}),
	z.strictObject({ ...grantFields, delivery: z.literal('repository'), environment: nonempty.optional(), secretName }),
	z.strictObject({
		...grantFields,
		delivery: z.literal('environment'),
		environment: z.string().min(1, 'Environment required'),
		secretName,
	}),
]);
export function parseGrant(value: unknown): Grant {
	return grantSchema.parse(value);
}
export function validCredential(alias: string, value: string): void {
	if (!credentialAliasPattern.test(alias) || !value || value.length > 48000) throw invalid('Invalid credential');
}
export class Vault {
	constructor(
		private store: Store,
		private credentials: CredentialStore,
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
	private async seal(additional: string, value: string): Promise<{ ciphertext: string; iv: string }> {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additional) },
			await this.key(this.activeKey),
			new TextEncoder().encode(value),
		);
		return { ciphertext: base64(new Uint8Array(ciphertext)), iv: base64(iv) };
	}
	private async open(additional: string, keyId: string, sealed: { ciphertext: string; iv: string }): Promise<string> {
		const clear = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bytes(sealed.iv), additionalData: new TextEncoder().encode(additional) },
			await this.key(keyId),
			bytes(sealed.ciphertext),
		);
		return new TextDecoder().decode(clear);
	}
	async replace(alias: string, value: string, actor: string): Promise<number> {
		validCredential(alias, value);
		const version = await this.credentials.nextVersion(alias);
		const sealed = await this.seal(`${alias}:${version}:${this.activeKey}`, value);
		await this.credentials.store({ alias, version, keyId: this.activeKey, ...sealed });
		await this.store.audit(actor, 'credential.replace', alias);
		return version;
	}
	async reveal(alias: string, actor: string): Promise<{ value: string; version: number }> {
		const row = await this.credentials.sealed(alias);
		if (!row) throw notFound('credential', 'No stored value under this name', alias);
		const value = await this.open(`${alias}:${row.version}:${row.key_id}`, row.key_id, row);
		await this.store.audit(actor, 'credential.access', alias);
		return { value, version: row.version };
	}
	async grant(grant: Grant, actor: string): Promise<void> {
		await this.credentials.putGrant(grant);
		await this.store.audit(actor, 'credential.grant', grant.id);
	}
	async revoke(id: string, actor: string): Promise<void> {
		await this.credentials.deleteGrant(id);
		await this.store.audit(actor, 'credential.revoke', id);
	}
	async runtime(alias: string, operation: string, identity: WorkflowIdentity): Promise<string> {
		const allowed = (await this.credentials.grantDocuments({ alias, repositoryId: identity.repositoryId }))
			.map(parseGrant)
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
		if (!allowed) throw forbidden('Credential grant denied');
		return (
			await this.reveal(alias, `run:${identity.repositoryId}:${identity.runId}:${identity.attempt}`)
		).value;
	}
	async synchronize(
		alias: string,
		gateway: RepositoryGateway,
		actor: string,
	): Promise<{ id: string; state: string }[]> {
		const grants = (await this.credentials.grantDocuments({ alias })).map(parseGrant);
		const secret = await this.reveal(alias, actor),
			outcomes: { id: string; state: string }[] = [];
		for (
			const grant of grants.filter((g) => g.delivery !== 'runtime')
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
							grant.environment,
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
			await this.credentials.recordDelivery(grant.id, secret.version, state);
			outcomes.push({ id: grant.id, state });
		}
		return outcomes;
	}
}
