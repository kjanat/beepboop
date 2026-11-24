import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { Effect } from 'effect';
import { CoordinatorClient } from '@/automation/coordinator-client.ts';
import type { ReleaseSteps } from '@/automation/release-workflow-driver.ts';
import { driveRelease } from '@/automation/release-workflow-driver.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { AutomationCoordinator } from '@/server/durable/automation-coordinator.ts';

export interface ReleaseWorkflowParams {
	repositoryId: number;
	preparationId: string;
}

interface ReleaseWorkflowBindings {
	AUTOMATION: DurableObjectNamespace<AutomationCoordinator>;
}

function workflowSteps(step: WorkflowStep): ReleaseSteps {
	return {
		run: (name, work) => fromPromise(() => step.do(name, () => Effect.runPromise(work))),
		sleep: (name, milliseconds) => fromPromise(() => step.sleep(name, milliseconds)),
		wait: (name, type) =>
			fromPromise(async () => {
				try {
					await step.waitForEvent(name, { type, timeout: '1 hour' });
				} catch (error) {
					if (!(error instanceof Error && error.name === 'WorkflowTimeoutError')) throw error;
				}
			}),
	};
}

/** One durable lifecycle per release set; repository workflows perform the actual work. */
export class ReleaseWorkflow extends WorkflowEntrypoint<ReleaseWorkflowBindings, ReleaseWorkflowParams> {
	run(event: WorkflowEvent<ReleaseWorkflowParams>, step: WorkflowStep) {
		const { repositoryId, preparationId } = event.payload;
		return Effect.runPromise(
			driveRelease(workflowSteps(step), { repositoryId, preparationId, workflowId: event.instanceId }).pipe(
				Effect.provide(CoordinatorClient.layer(id => this.env.AUTOMATION.getByName(String(id)))),
			),
		);
	}
}
