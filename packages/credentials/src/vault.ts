import { Context, Effect, Layer } from 'effect';
import type { CredentialStore } from '@/credentials/adapters/d1/credentials.ts';
import type { GrantStore } from '@/credentials/adapters/d1/grants.ts';
import type { SecretDeliveryStore } from '@/credentials/adapters/d1/secret-deliveries.ts';
import type { Grant, SecretGrant, WorkflowRun } from '@/credentials/grant.ts';
import { allowsRun, isRuntimeGrant } from '@/credentials/grant.ts';
import type { Permissions } from '@/github/app.ts';
import type { SecretTarget } from '@/github/secrets.ts';
import { putSecret } from '@/github/secrets.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { base64, bytes } from '@/kernel/crypto/base64.ts';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden, invalid, notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { credentialAliasPattern } from '@/kernel/schema/ids.ts';
import type { AuditStore } from '@/persistence/d1/audit';

export interface CredentialStores {
	readonly credentials: CredentialStore;
	readonly grants: GrantStore;
	readonly deliveries: SecretDeliveryStore;
}

export interface SecretWriter extends GitHubRequests {
	token(name: string, id: number, permissions: Permissions): Effect.Effect<string, DomainError>;
}
export type SyncState = 'succeeded' | 'failed';
export interface SyncOutcome {
	readonly id: string;
	readonly state: SyncState;
}

function secretTarget(grant: SecretGrant): SecretTarget {
	return grant._tag === 'EnvironmentSecret'
		? { delivery: 'environment', repositoryId: grant.repositoryId, environment: grant.environment }
		: { delivery: 'repository', repository: grant.repository };
}
export function validCredential(alias: string, value: string): Effect.Effect<void, DomainError> {
	return !credentialAliasPattern.test(alias) || !value || value.length > 48000
		? Effect.fail(invalid('Invalid credential'))
		: Effect.void;
}
export class Vault {
	constructor(
		private audit: AuditStore,
		private stores: CredentialStores,
		private keyring: Record<string, string>,
		private activeKey: string,
	) {}
	private key(id: string): Effect.Effect<CryptoKey, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const value = this.keyring[id];
			if (!value) return yield* precondition('Encryption key unavailable');
			const raw = yield* fromSync(() => bytes(value));
			if (raw.length !== 32) return yield* precondition('Encryption key must be 32 bytes');
			return yield* fromPromise(() => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
		});
	}
	private seal(additional: string, value: string): Effect.Effect<{ ciphertext: string; iv: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const key = yield* this.key(this.activeKey);
			const ciphertext = yield* fromPromise(() =>
				crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additional) },
					key,
					new TextEncoder().encode(value),
				)
			);
			return { ciphertext: base64(new Uint8Array(ciphertext)), iv: base64(iv) };
		});
	}
	private open(
		additional: string,
		keyId: string,
		sealed: { ciphertext: string; iv: string },
	): Effect.Effect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const key = yield* this.key(keyId);
			const clear = yield* fromPromise(() =>
				crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: bytes(sealed.iv), additionalData: new TextEncoder().encode(additional) },
					key,
					bytes(sealed.ciphertext),
				)
			);
			return new TextDecoder().decode(clear);
		});
	}
	replace(alias: string, value: string, actor: string): Effect.Effect<number, DomainError> {
		return Effect.gen({ self: this }, function*() {
			yield* validCredential(alias, value);
			const version = yield* this.stores.credentials.nextVersion(alias);
			const sealed = yield* this.seal(`${alias}:${version}:${this.activeKey}`, value);
			yield* this.stores.credentials.store({ alias, version, keyId: this.activeKey, ...sealed });
			yield* this.audit.record(actor, 'credential.replace', alias);
			return version;
		});
	}
	reveal(alias: string, actor: string): Effect.Effect<{ value: string; version: number }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const row = yield* this.stores.credentials.sealed(alias);
			if (!row) return yield* notFound('credential', 'No stored value under this name', alias);
			const value = yield* this.open(`${alias}:${row.version}:${row.key_id}`, row.key_id, row);
			yield* this.audit.record(actor, 'credential.access', alias);
			return { value, version: row.version };
		});
	}
	grant(grant: Grant, actor: string): Effect.Effect<void, DomainError> {
		return this.stores.grants.put(grant).pipe(
			Effect.andThen(this.audit.record(actor, 'credential.grant', grant.id)),
		);
	}
	revoke(id: string, actor: string): Effect.Effect<void, DomainError> {
		return this.stores.grants.delete(id).pipe(Effect.andThen(this.audit.record(actor, 'credential.revoke', id)));
	}
	runtime(
		alias: string,
		operation: string,
		identity: WorkflowRun & { readonly repositoryId: number; readonly runId: number; readonly attempt: number },
	): Effect.Effect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const allowed = (yield* this.stores.grants.list({ alias, repositoryId: identity.repositoryId })).some(grant =>
				allowsRun(grant, operation, identity)
			);
			if (!allowed) return yield* forbidden('Credential grant denied');
			return (yield* this.reveal(alias, `run:${identity.repositoryId}:${identity.runId}:${identity.attempt}`)).value;
		});
	}
	synchronize(
		alias: string,
		gateway: SecretWriter,
		actor: string,
	): Effect.Effect<SyncOutcome[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const grants = yield* this.stores.grants.list({ alias });
			const secret = yield* this.reveal(alias, actor);
			return yield* Effect.forEach(grants.filter((g): g is SecretGrant => !isRuntimeGrant(g)), grant => {
				const permissions: Record<string, 'read' | 'write'> = grant._tag === 'EnvironmentSecret'
					? { environments: 'write', contents: 'read' }
					: { secrets: 'write', contents: 'read' };
				return Effect.gen(function*(): Effect.fn.Return<SyncState, DomainError> {
					const token = yield* gateway.token(grant.repository, grant.repositoryId, permissions);
					yield* putSecret(gateway, secretTarget(grant), grant.secretName, secret.value, token);
					return 'succeeded';
				}).pipe(
					Effect.orElseSucceed((): SyncState => 'failed'),
					Effect.tap(state => this.stores.deliveries.record(grant.id, secret.version, state)),
					Effect.map(state => ({ id: grant.id, state })),
				);
			});
		});
	}
}

export class Secrets extends Context.Service<Secrets, {
	readonly reveal: (alias: string, actor: string) => Effect.Effect<string, DomainError>;
}>()('beepboop/Secrets') {}

export function secretsLayer(vault: Pick<Vault, 'reveal'>): Layer.Layer<Secrets> {
	return Layer.succeed(Secrets, {
		reveal: (alias, actor) => vault.reveal(alias, actor).pipe(Effect.map(credential => credential.value)),
	});
}
