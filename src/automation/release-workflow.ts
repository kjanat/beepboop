import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AutomationCoordinator } from '@/automation/coordinator';

export interface ReleaseWorkflowParams {
	repositoryId: number;
	preparationId: string;
}

interface ReleaseWorkflowBindings {
	AUTOMATION: DurableObjectNamespace<AutomationCoordinator>;
}

/** One durable lifecycle per release set; repository workflows perform the actual work. */
export class ReleaseWorkflow extends WorkflowEntrypoint<ReleaseWorkflowBindings, ReleaseWorkflowParams> {
	async run(event: WorkflowEvent<ReleaseWorkflowParams>, step: WorkflowStep) {
		const coordinator = this.env.AUTOMATION.getByName(String(event.payload.repositoryId));
		try {
			const operations = await step.do(
				'Load release operations',
				() => coordinator.releaseOperations(event.payload.preparationId, event.instanceId),
			);
			const pending = new Map<string, Promise<void>>();
			const run = (id: string): Promise<void> => {
				const existing = pending.get(id);
				if (existing) return existing;
				const operation = operations.find(operation => operation.id === id);
				if (!operation) throw new Error('Release dependency is missing');
				const result = (async () => {
					await Promise.all(operation.dependencies.map(run));
					for (let attempt = 0;; attempt++) {
						// The journal records dispatch intent before GitHub is called. Replaying this
						// RPC reconciles that intent rather than issuing another dispatch.
						const state = await step.do(
							`${operation.operation}: reconcile ${attempt}`,
							() => coordinator.advanceReleaseOperation(event.payload.preparationId, event.instanceId, id),
						);
						if (state === 'succeeded') return;
						try {
							// Events are hints; the journal, never the event payload, decides progress.
							await step.waitForEvent(`${operation.operation}: wait ${attempt}`, {
								type: id,
								timeout: '1 hour',
							});
						} catch (error) {
							if (!(error instanceof Error) || error.name !== 'WorkflowTimeoutError') throw error;
							// Recover a missed GitHub webhook or a delayed publication independently.
						}
					}
				})();
				pending.set(id, result);
				return result;
			};
			await Promise.all(operations.map(operation => run(operation.id)));
			await step.do(
				'Complete release',
				() => coordinator.completeReleaseWorkflow(event.payload.preparationId, event.instanceId),
			);
			return { preparationId: event.payload.preparationId, operations: operations.map(operation => operation.id) };
		} catch (error) {
			await step.do(
				'Record coordination failure',
				() => coordinator.releaseWorkflowInterrupted(event.payload.preparationId, event.instanceId),
			);
			throw error;
		}
	}
}
