import type { AutomationService } from '@/automation/service';
import type { RepositoryRecord } from '@/automation/types';
import { notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin } from '@/server/handlers/kit';

async function enrolled(service: AutomationService, id: number): Promise<RepositoryRecord> {
	const repository = await service.store.repository(id);
	if (!repository) throw notFound('repository', 'Repository not enrolled', String(id));
	return repository;
}

export const wingetEndpoints = {
	wingetList: admin(routes.wingetList, (_, { service }) => service.winget().list()),
	wingetRefresh: admin(routes.wingetRefresh, async (_, { service }) => {
		await service.winget().reconcile();
		return { ok: true };
	}),
	wingetReleases: admin(
		routes.wingetReleases,
		async (input, { service }) => service.winget().releases(await enrolled(service, input.repositoryId)),
	),
	wingetPreview: admin(
		routes.wingetPreview,
		async (input, { service }) => service.winget().plan(await enrolled(service, input.repositoryId), input.releaseId),
	),
	wingetSubmit: admin(routes.wingetSubmit, async (input, { service, actor }) => {
		const result = await service.winget().submit(
			await enrolled(service, input.repositoryId),
			input.releaseId,
			input.digest,
		);
		await service.store.audit(actor, 'winget.request', result.plan.id);
		return result;
	}),
} as const;
