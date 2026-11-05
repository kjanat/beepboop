import { Effect } from 'effect';
import type { AutomationService } from '@/automation/service';
import type { RepositoryRecord } from '@/automation/types';
import { type DomainError, notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin } from '@/server/handlers/kit';

function enrolled(service: AutomationService, id: number): Effect.Effect<RepositoryRecord, DomainError> {
	return service.store.repository(id).pipe(
		Effect.filterOrFail(
			(repository): repository is RepositoryRecord => repository !== undefined,
			() => notFound('repository', 'Repository not enrolled', String(id)),
		),
	);
}

export const wingetEndpoints = {
	wingetList: admin(routes.wingetList, (_, { service }) => service.winget().list()),
	wingetRefresh: admin(
		routes.wingetRefresh,
		(_, { service }) => service.winget().reconcile().pipe(Effect.as({ ok: true })),
	),
	wingetReleases: admin(
		routes.wingetReleases,
		(input, { service }) =>
			enrolled(service, input.repositoryId).pipe(Effect.flatMap(repository => service.winget().releases(repository))),
	),
	wingetPreview: admin(
		routes.wingetPreview,
		(input, { service }) =>
			enrolled(service, input.repositoryId).pipe(
				Effect.flatMap(repository => service.winget().plan(repository, input.releaseId)),
			),
	),
	wingetSubmit: admin(routes.wingetSubmit, (input, { service, actor }) =>
		Effect.gen(function*() {
			const repository = yield* enrolled(service, input.repositoryId);
			const result = yield* service.winget().submit(repository, input.releaseId, input.digest);
			yield* service.store.audit(actor, 'winget.request', result.plan.id);
			return result;
		})),
} as const;
