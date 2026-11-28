import { Effect } from 'effect';
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
import { requireReady } from '@/domain/repository';
import { workflowPath } from '@/domain/workflow-path.ts';
import { forbidden } from '@/kernel/errors/domain-error.ts';
import { admin, elevated, readyRepository, workflow } from '@/server/handlers/kit';

const triageCredential = 'TYPESAFE_API_KEY';
const triageEvents = new Set(['issues', 'pull_request_target', 'workflow_dispatch']);

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
	workflowTriage: workflow(routes.workflowTriage, (_, { service, enrollment, identity }) =>
		Effect.gen(function*() {
			const repository = yield* requireReady(enrollment);
			const ref = `refs/heads/${repository.defaultBranch}`;
			if (identity.repository !== repository.name || identity.ref !== ref || !triageEvents.has(identity.event)) {
				return yield* forbidden('Triage requires an issue, target pull request or manual run from the default branch');
			}
			const configured = Object.values(repository.configuration.streams).some(stream => {
				const binding = stream.workflows.triage;
				return binding && stream.credentials.includes(triageCredential)
					&& (binding.ref === undefined || binding.ref === repository.defaultBranch || binding.ref === ref)
					&& identity.workflowRef === `${repository.name}/${workflowPath(binding.file)}@${ref}`;
			});
			if (!configured) return yield* forbidden('Workflow is not configured for triage credentials');
			const key = yield* service.vault().runtime(triageCredential, 'triage', identity);
			return { key };
		}), { allowPullRequestTarget: true }),
} as const;
