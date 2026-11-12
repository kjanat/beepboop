import { Context, Effect, Layer, Schema } from 'effect';
import { seal } from 'tweetnacl-sealedbox-js';
import type { WorkflowIdentity } from '@/automation/auth';
import { base64, bytes } from '@/automation/auth';
import type { RepositoryGateway } from '@/automation/github';
import { matchesRef } from '@/automation/policy';
import { repositoryNamePattern } from '@/automation/repository-name';
import type { Store } from '@/automation/store';
import { workflowFilePattern } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, forbidden, invalid, notFound, precondition } from '@/contract/errors';
import { credentialAliasPattern, githubSecretNamePattern } from '@/contract/ids';
import { fromPromise, fromSync } from '@/failure';
import { textSchema } from '@/model';
import type { CredentialStore } from '@/persistence/d1/credentials';
import { decodeSync, matchesPattern, mutableStruct } from '@/schema';

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
const secretPublicKey = mutableStruct({ key: textSchema, key_id: textSchema });
const grantFields = {
	id: textSchema,
	alias: Schema.String.check(matchesPattern(/^[\w-]+$/)),
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	repository: Schema.String.check(matchesPattern(repositoryNamePattern)),
	operation: textSchema,
	workflow: Schema.String.check(matchesPattern(workflowFilePattern)),
	ref: Schema.String.check(Schema.isStartingWith('refs/')),
};
const secretName = Schema.String.check(matchesPattern(githubSecretNamePattern, { message: 'Secret name required' }))
	.annotateKey({ messageMissingKey: 'Secret name required' });
const grantSchema = Schema.Union([
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('runtime'),
		environment: Schema.optional(textSchema),
		secretName: Schema.optional(textSchema),
	}),
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('repository'),
		environment: Schema.optional(textSchema),
		secretName,
	}),
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('environment'),
		environment: Schema.String.check(Schema.isMinLength(1, { message: 'Environment required' })),
		secretName,
	}),
]);
export function runtimeGrant(grant: Grant, operation: string, repository: string, ref: string): boolean {
	return grant.delivery === 'runtime' && grant.operation === operation && grant.repository === repository
		&& matchesRef(grant.ref, ref);
}
export function parseGrant(value: unknown): Effect.Effect<Grant, DomainError> {
	return fromSync(() => decodeSync(grantSchema, value));
}
export function requestGrant(value: unknown): Effect.Effect<Grant, DomainError> {
	return decodeRequest(grantSchema, value);
}
export function validCredential(alias: string, value: string): Effect.Effect<void, DomainError> {
	return !credentialAliasPattern.test(alias) || !value || value.length > 48000
		? Effect.fail(invalid('Invalid credential'))
		: Effect.void;
}
export class Vault {
	constructor(
		private store: Store,
		private credentials: CredentialStore,
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
			const version = yield* this.credentials.nextVersion(alias);
			const sealed = yield* this.seal(`${alias}:${version}:${this.activeKey}`, value);
			yield* this.credentials.store({ alias, version, keyId: this.activeKey, ...sealed });
			yield* this.store.audit(actor, 'credential.replace', alias);
			return version;
		});
	}
	reveal(alias: string, actor: string): Effect.Effect<{ value: string; version: number }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const row = yield* this.credentials.sealed(alias);
			if (!row) return yield* notFound('credential', 'No stored value under this name', alias);
			const value = yield* this.open(`${alias}:${row.version}:${row.key_id}`, row.key_id, row);
			yield* this.store.audit(actor, 'credential.access', alias);
			return { value, version: row.version };
		});
	}
	grant(grant: Grant, actor: string): Effect.Effect<void, DomainError> {
		return this.credentials.putGrant(grant).pipe(
			Effect.andThen(this.store.audit(actor, 'credential.grant', grant.id)),
		);
	}
	revoke(id: string, actor: string): Effect.Effect<void, DomainError> {
		return this.credentials.deleteGrant(id).pipe(Effect.andThen(this.store.audit(actor, 'credential.revoke', id)));
	}
	private grants(filter: { alias: string; repositoryId?: number }): Effect.Effect<Grant[], DomainError> {
		return this.credentials.grantDocuments(filter).pipe(
			Effect.flatMap(documents => Effect.forEach(documents, parseGrant)),
		);
	}
	runtime(alias: string, operation: string, identity: WorkflowIdentity): Effect.Effect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const allowed = (yield* this.grants({ alias, repositoryId: identity.repositoryId })).some(
				(g) =>
					runtimeGrant(g, operation, identity.repository, identity.ref)
					&& g.environment === identity.environment
					&& identity.workflowRef
						=== `${identity.repository}/.github/workflows/${g.workflow}@${identity.ref}`,
			);
			if (!allowed) return yield* forbidden('Credential grant denied');
			return (yield* this.reveal(alias, `run:${identity.repositoryId}:${identity.runId}:${identity.attempt}`)).value;
		});
	}
	synchronize(
		alias: string,
		gateway: RepositoryGateway,
		actor: string,
	): Effect.Effect<{ id: string; state: string }[], DomainError> {
		return Effect.gen({ self: this }, function*() {
			const grants = yield* this.grants({ alias });
			const secret = yield* this.reveal(alias, actor);
			return yield* Effect.forEach(grants.filter((g) => g.delivery !== 'runtime'), grant => {
				const permissions: Record<string, 'read' | 'write'> = grant.delivery === 'environment'
					? { environments: 'write', contents: 'read' }
					: { secrets: 'write', contents: 'read' };
				const path = grant.delivery === 'environment'
					? `/repositories/${grant.repositoryId}/environments/${encodeURIComponent(grant.environment)}/secrets`
					: `/repos/${grant.repository}/actions/secrets`;
				return Effect.gen(function*() {
					const token = yield* gateway.token(grant.repository, grant.repositoryId, permissions);
					const publicKey = yield* gateway.read(secretPublicKey, `${path}/public-key`, token);
					const encrypted = yield* fromSync(() => seal(new TextEncoder().encode(secret.value), bytes(publicKey.key)));
					yield* gateway.call(`${path}/${grant.secretName}`, token, 'PUT', {
						encrypted_value: base64(encrypted),
						key_id: publicKey.key_id,
					});
					return 'succeeded';
				}).pipe(
					Effect.orElseSucceed(() => 'failed'),
					Effect.tap(state => this.credentials.recordDelivery(grant.id, secret.version, state)),
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
