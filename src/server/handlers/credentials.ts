import { Effect } from 'effect';
import { configuredGrant } from '@/automation/access';
import { parseGrant, validCredential } from '@/automation/vault';
import { conflict, type DomainError, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { requireReady } from '@/domain/repository';
import type { CredentialStore } from '@/persistence/d1/credentials';
import { admin, elevated } from '@/server/handlers/kit';

function stored(credentials: CredentialStore, alias: string): Effect.Effect<void, DomainError> {
	return credentials.activeVersion(alias).pipe(
		Effect.filterOrFail(
			version => version !== undefined,
			() => notFound('credential', 'No stored value under this name', alias),
		),
		Effect.asVoid,
	);
}

export const credentialEndpoints = {
	credentialsList: admin(routes.credentialsList, (_, { service }) =>
		Effect.all({
			credentials: service.credentials.list(),
			grants: service.credentials.grantDocuments().pipe(
				Effect.flatMap(documents => Effect.forEach(documents, parseGrant)),
			),
			deliveries: service.credentials.deliveries(),
		})),
	credentialsReplace: elevated(routes.credentialsReplace, (input, { service, actor }) =>
		Effect.gen(function*() {
			yield* validCredential(input.alias, input.value);
			if (input.expectedVersion !== undefined) {
				const current = (yield* service.credentials.activeVersion(input.alias)) ?? null;
				if (current !== input.expectedVersion) {
					return yield* conflict('stale-version', `${input.alias} changed since you checked it; review it again`);
				}
			}
			return {
				commit: service.vault().replace(input.alias, input.value, actor).pipe(Effect.map(version => ({ version }))),
			};
		})),
	credentialsReveal: elevated(
		routes.credentialsReveal,
		(input, { service, actor }) =>
			stored(service.credentials, input.alias).pipe(
				Effect.as({ commit: service.vault().reveal(input.alias, actor) }),
			),
	),
	credentialsSync: elevated(
		routes.credentialsSync,
		(input, { service, actor }) =>
			stored(service.credentials, input.alias).pipe(
				Effect.as({ commit: service.vault().synchronize(input.alias, service.gateway, actor) }),
			),
	),
	credentialsGrant: elevated(routes.credentialsGrant, (input, { service, actor }) =>
		Effect.gen(function*() {
			const { repositoryId } = input.selection;
			const repository = yield* service.store.repository(repositoryId);
			if (!repository) return yield* notFound('repository', 'Repository is not enrolled', String(repositoryId));
			const ready = yield* requireReady(repository);
			const grant = yield* configuredGrant(ready, input.selection);
			if ((yield* service.credentials.activeVersion(grant.alias)) === undefined) {
				return yield* precondition('Store a value under this name before granting access');
			}
			return { commit: service.vault().grant(grant, actor).pipe(Effect.as({ granted: true })) };
		})),
	credentialsRevoke: elevated(routes.credentialsRevoke, (input, { service, actor }) =>
		Effect.gen(function*() {
			if (!(yield* service.credentials.hasGrant(input.grantId))) {
				return yield* notFound('grant', 'Unknown grant', input.grantId);
			}
			return { commit: service.vault().revoke(input.grantId, actor).pipe(Effect.as({ revoked: true })) };
		})),
} as const;
