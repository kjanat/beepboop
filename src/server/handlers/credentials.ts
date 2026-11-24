import type { AutomationService } from '@/automation/service';
import { routes } from '@/contract/routes';
import type { CredentialEndpoints } from '@/credentials/http/credentials.ts';
import {
	grantCredential,
	listCredentials,
	replaceCredential,
	revealCredential,
	revokeGrant,
	syncCredential,
} from '@/credentials/http/credentials.ts';
import { admin, elevated, readyRepository } from '@/server/handlers/kit';

function endpoints(service: AutomationService): CredentialEndpoints {
	return {
		credentials: service.credentials,
		grants: service.grants,
		deliveries: service.secretDeliveries,
		vault: service.vault(),
		writer: service.gateway,
		readyRepository: id => readyRepository(service, id, 'Repository is not enrolled'),
		wake: repositoryId => service.coordinators.wake(repositoryId),
	};
}

export const credentialEndpoints = {
	credentialsList: admin(routes.credentialsList, (_, { service }) => listCredentials(endpoints(service))),
	credentialsReplace: elevated(
		routes.credentialsReplace,
		(input, { service, actor }) => replaceCredential(endpoints(service), input, actor),
	),
	credentialsReveal: elevated(
		routes.credentialsReveal,
		(input, { service, actor }) => revealCredential(endpoints(service), input.alias, actor),
	),
	credentialsSync: elevated(
		routes.credentialsSync,
		(input, { service, actor }) => syncCredential(endpoints(service), input.alias, actor),
	),
	credentialsGrant: elevated(
		routes.credentialsGrant,
		(input, { service, actor }) => grantCredential(endpoints(service), input.selection, actor),
	),
	credentialsRevoke: elevated(
		routes.credentialsRevoke,
		(input, { service, actor }) => revokeGrant(endpoints(service), input.grantId, actor),
	),
} as const;
