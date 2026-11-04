import { notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin, elevated } from '@/server/handlers/kit';

export const changeEndpoints = {
	changes: admin(routes.changes, (input, { service }) => service.changes.since(input.since, input.repositoryId)),
	adminReindex: elevated(routes.adminReindex, async (input, { service, actor }) => {
		const known = (await service.store.readRepositories()).map(entry =>
			entry.kind === 'readable' ? entry.value.id : entry.id
		);
		if (input.repositoryId !== undefined && !known.includes(input.repositoryId)) {
			throw notFound('repository', 'Unknown repository', String(input.repositoryId));
		}
		const targets = input.repositoryId === undefined ? known : [input.repositoryId];
		return async () => {
			let queued = 0;
			for (const id of targets) queued += await service.coordinator(id).reindex(id);
			await service.store.audit(actor, 'admin.reindex', targets.join(','));
			return { queued };
		};
	}),
} as const;
