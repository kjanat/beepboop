import type { AutomationService } from '@/automation/service';
import type { Execution } from '@/automation/types';
import { forbidden, notFound } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin } from '@/server/handlers/kit';

async function execution(service: AutomationService, id: string, repositoryId?: number): Promise<Execution> {
	const found = await service.store.execution(id);
	if (!found) throw notFound('execution', 'Unknown execution', id);
	if (repositoryId !== undefined && found.repositoryId !== repositoryId) {
		throw forbidden('Execution belongs to another repository');
	}
	return found;
}

export const executionEndpoints = {
	executionsList: admin(routes.executionsList, (_, { service }) => service.store.executions()),
	executionsApproval: admin(routes.executionsApproval, async (input, { service }) => {
		const found = await execution(service, input.id, input.repositoryId);
		return service.coordinator(found.repositoryId).approvalReadiness(found.id);
	}),
	executionsCancel: admin(routes.executionsCancel, async (input, { service, actor }) => {
		const found = await execution(service, input.id, input.repositoryId);
		return service.coordinator(found.repositoryId).cancel(found.id, actor);
	}),
	executionsApprove: admin(routes.executionsApprove, async (input, { service, actor }) => {
		const found = await execution(service, input.id, input.repositoryId);
		return service.coordinator(found.repositoryId).approve(found.id, input.sourceSha, actor, input.force === true);
	}),
	executionsRecover: admin(routes.executionsRecover, async (input, { service, actor }) => {
		const found = await execution(service, input.id, input.repositoryId);
		return service.coordinator(found.repositoryId).recover(found.id, input.action, actor);
	}),
} as const;
