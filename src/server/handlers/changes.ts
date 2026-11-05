import { Effect } from 'effect';
import { notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { fromPromise } from '@/failure';
import { admin, elevated } from '@/server/handlers/kit';

export const changeEndpoints = {
	changes: admin(routes.changes, (input, { service }) => service.changes.since(input.since, input.repositoryId)),
	adminReindex: elevated(routes.adminReindex, (input, { service, actor }) =>
		Effect.gen(function*() {
			const known = (yield* service.store.readRepositories()).map(entry =>
				entry.kind === 'readable' ? entry.value.id : entry.id
			);
			if (input.repositoryId !== undefined && !known.includes(input.repositoryId)) {
				return yield* notFound('repository', 'Unknown repository', String(input.repositoryId));
			}
			const targets = input.repositoryId === undefined ? known : [input.repositoryId];
			return {
				commit: Effect.gen(function*() {
					const counts = yield* Effect.forEach(targets, id => fromPromise(() => service.coordinator(id).reindex(id)));
					yield* service.store.audit(actor, 'admin.reindex', targets.join(','));
					return { queued: counts.reduce((sum, count) => sum + count, 0) };
				}),
			};
		})),
} as const;
