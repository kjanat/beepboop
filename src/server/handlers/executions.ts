import { Effect } from 'effect';
import type { AutomationService } from '@/automation/service';
import type { Execution } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { fromPromise } from '@/failure';
import { admin } from '@/server/handlers/kit';

function execution(
	service: AutomationService,
	id: string,
	repositoryId?: number,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const owner = repositoryId ?? (yield* service.store.execution(id))?.repositoryId;
		const found = owner === undefined ? undefined : yield* fromPromise(() => service.coordinator(owner).execution(id));
		if (!found) return yield* notFound('execution', 'Unknown execution', id);
		return found;
	});
}

export const executionEndpoints = {
	executionsList: admin(routes.executionsList, (_, { service }) => service.store.executions()),
	executionsApproval: admin(
		routes.executionsApproval,
		(input, { service }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => fromPromise(() => service.coordinator(found.repositoryId).approvalReadiness(found.id))),
			),
	),
	executionsCancel: admin(
		routes.executionsCancel,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => fromPromise(() => service.coordinator(found.repositoryId).cancel(found.id, actor))),
			),
	),
	executionsApprove: admin(
		routes.executionsApprove,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found =>
					fromPromise(() =>
						service.coordinator(found.repositoryId).approve(found.id, input.sourceSha, actor, input.force === true)
					)
				),
			),
	),
	executionsRecover: admin(
		routes.executionsRecover,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found =>
					fromPromise(() => service.coordinator(found.repositoryId).recover(found.id, input.action, actor))
				),
			),
	),
} as const;
