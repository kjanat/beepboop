import { configuredGrant } from '@/automation/access';
import { parseGrant, validCredential } from '@/automation/vault';
import { conflict, notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import type { CredentialStore } from '@/persistence/d1/credentials';
import { admin, elevated } from '@/server/handlers/kit';

async function stored(credentials: CredentialStore, alias: string): Promise<void> {
	if (await credentials.activeVersion(alias) === undefined) {
		throw notFound('credential', 'No stored value under this name', alias);
	}
}

export const credentialEndpoints = {
	credentialsList: admin(routes.credentialsList, async (_, { service }) => ({
		credentials: await service.credentials.list(),
		grants: (await service.credentials.grantDocuments()).map(parseGrant),
		deliveries: await service.credentials.deliveries(),
	})),
	credentialsReplace: elevated(routes.credentialsReplace, async (input, { service, actor }) => {
		validCredential(input.alias, input.value);
		if (input.expectedVersion !== undefined) {
			const current = await service.credentials.activeVersion(input.alias) ?? null;
			if (current !== input.expectedVersion) {
				throw conflict('stale-version', `${input.alias} changed since you checked it; review it again`);
			}
		}
		return async () => ({ version: await service.vault().replace(input.alias, input.value, actor) });
	}),
	credentialsReveal: elevated(routes.credentialsReveal, async (input, { service, actor }) => {
		await stored(service.credentials, input.alias);
		return () => service.vault().reveal(input.alias, actor);
	}),
	credentialsSync: elevated(routes.credentialsSync, async (input, { service, actor }) => {
		await stored(service.credentials, input.alias);
		return () => service.vault().synchronize(input.alias, service.gateway, actor);
	}),
	credentialsGrant: elevated(routes.credentialsGrant, async (input, { service, actor }) => {
		const { repositoryId } = input.selection;
		const repository = await service.store.repository(repositoryId);
		if (!repository) throw notFound('repository', 'Repository is not enrolled', String(repositoryId));
		const grant = configuredGrant(repository, input.selection);
		if (await service.credentials.activeVersion(grant.alias) === undefined) {
			throw precondition('Store a value under this name before granting access');
		}
		return async () => {
			await service.vault().grant(grant, actor);
			return { granted: true };
		};
	}),
	credentialsRevoke: elevated(routes.credentialsRevoke, async (input, { service, actor }) => {
		if (!await service.credentials.hasGrant(input.grantId)) throw notFound('grant', 'Unknown grant', input.grantId);
		return async () => {
			await service.vault().revoke(input.grantId, actor);
			return { revoked: true };
		};
	}),
} as const;
