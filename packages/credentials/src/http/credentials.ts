import { Effect } from 'effect';
import { configuredGrant } from '@/credentials/access.ts';
import type { CredentialStore } from '@/credentials/adapters/d1/credentials.ts';
import type { GrantStore } from '@/credentials/adapters/d1/grants.ts';
import type { SecretDeliveryStore } from '@/credentials/adapters/d1/secret-deliveries.ts';
import type { WorkflowRun } from '@/credentials/grant.ts';
import { grantRow } from '@/credentials/grant.ts';
import type { SecretWriter, Vault } from '@/credentials/vault.ts';
import { validCredential } from '@/credentials/vault.ts';
import type { ReadyRepository } from '@/domain/repository';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { conflict, forbidden, notFound, precondition } from '@/kernel/errors/domain-error.ts';

export interface CredentialEndpoints {
	readonly credentials: CredentialStore;
	readonly grants: GrantStore;
	readonly deliveries: SecretDeliveryStore;
	readonly vault: Pick<Vault, keyof Vault>;
	readonly writer: SecretWriter;
	readonly readyRepository: (id: number) => Effect.Effect<ReadyRepository, DomainError>;
	readonly wake: (repositoryId: number) => Effect.Effect<void, DomainError>;
}

function stored(credentials: CredentialStore, alias: string): Effect.Effect<void, DomainError> {
	return credentials.activeVersion(alias).pipe(
		Effect.filterOrFail(
			version => version !== undefined,
			() => notFound('credential', 'No stored value under this name', alias),
		),
		Effect.asVoid,
	);
}

export function listCredentials(endpoints: CredentialEndpoints) {
	return Effect.all({
		credentials: endpoints.credentials.list().pipe(Effect.map(versions =>
			versions.map(version => ({
				alias: version.alias,
				version: version.version,
				key_id: version.keyId,
				active: Number(version.active),
				created_at: version.createdAt,
			}))
		)),
		grants: endpoints.grants.list().pipe(Effect.map(grants => grants.map(grantRow))),
		deliveries: endpoints.deliveries.list().pipe(Effect.map(deliveries =>
			deliveries.map(delivery => ({
				grant_id: delivery.grantId,
				version: delivery.version,
				state: delivery.state,
				updated_at: delivery.updatedAt,
			}))
		)),
	});
}

export const replaceCredential = Effect.fnUntraced(function*(
	endpoints: CredentialEndpoints,
	input: { readonly alias: string; readonly value: string; readonly expectedVersion?: number | null | undefined },
	actor: string,
) {
	yield* validCredential(input.alias, input.value);
	if (input.expectedVersion !== undefined) {
		const current = (yield* endpoints.credentials.activeVersion(input.alias)) ?? null;
		if (current !== input.expectedVersion) {
			return yield* conflict('stale-version', `${input.alias} changed since you checked it; review it again`);
		}
	}
	return {
		commit: endpoints.vault.replace(input.alias, input.value, actor).pipe(Effect.map(version => ({ version }))),
	};
});

export function revealCredential(endpoints: CredentialEndpoints, alias: string, actor: string) {
	return stored(endpoints.credentials, alias).pipe(Effect.as({ commit: endpoints.vault.reveal(alias, actor) }));
}

export function syncCredential(endpoints: CredentialEndpoints, alias: string, actor: string) {
	return stored(endpoints.credentials, alias).pipe(
		Effect.as({ commit: endpoints.vault.synchronize(alias, endpoints.writer, actor) }),
	);
}

export const grantCredential = Effect.fnUntraced(function*(
	endpoints: CredentialEndpoints,
	selection: { readonly repositoryId: number },
	actor: string,
) {
	const ready = yield* endpoints.readyRepository(selection.repositoryId);
	const grant = yield* configuredGrant(ready, selection);
	if ((yield* endpoints.credentials.activeVersion(grant.alias)) === undefined) {
		return yield* precondition('Store a value under this name before granting access');
	}
	return {
		commit: endpoints.vault.grant(grant, actor).pipe(
			Effect.andThen(endpoints.wake(grant.repositoryId)),
			Effect.as({ granted: true }),
		),
	};
});

export const revokeGrant = Effect.fnUntraced(function*(endpoints: CredentialEndpoints, grantId: string, actor: string) {
	if (!(yield* endpoints.grants.has(grantId))) {
		return yield* notFound('grant', 'Unknown grant', grantId);
	}
	return { commit: endpoints.vault.revoke(grantId, actor).pipe(Effect.as({ revoked: true })) };
});

export const deliverCredentials = Effect.fnUntraced(function*(
	vault: Pick<Vault, 'runtime'>,
	request: {
		readonly allowed: readonly string[];
		readonly aliases: readonly string[];
		readonly operation: string;
		readonly run: WorkflowRun & { readonly repositoryId: number; readonly runId: number; readonly attempt: number };
	},
) {
	const values: Record<string, string> = {};
	for (const alias of request.aliases) {
		if (!request.allowed.includes(alias)) return yield* forbidden('Alias not requested by the stream');
		values[alias] = yield* vault.runtime(alias, request.operation, request.run);
	}
	return values;
});
