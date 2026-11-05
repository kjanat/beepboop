import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { Cause, Effect } from 'effect';
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
	run(event: WorkflowEvent<ReleaseWorkflowParams>, step: WorkflowStep) {
		const coordinator = this.env.AUTOMATION.getByName(String(event.payload.repositoryId));
		const { preparationId } = event.payload;
		const workflowId = event.instanceId;
		return Effect.runPromise(
			Effect.gen(function*() {
				const operations = yield* Effect.promise(() =>
					step.do('Load release operations', () => coordinator.releaseOperations(preparationId, workflowId))
				);
				const pending = new Map<string, Effect.Effect<void>>();
				const advance = (id: string, label: string): Effect.Effect<void> =>
					Effect.gen(function*() {
						for (let attempt = 0;; attempt++) {
							// The journal records dispatch intent before GitHub is called. Replaying this
							// RPC reconciles that intent rather than issuing another dispatch.
							const state = yield* Effect.promise(() =>
								step.do(
									`${label}: reconcile ${attempt}`,
									() => coordinator.advanceReleaseOperation(preparationId, workflowId, id),
								)
							);
							if (state === 'succeeded') return;
							const delay = yield* Effect.promise(() =>
								step.do(`${label}: delay ${attempt}`, () => coordinator.operationDelay(preparationId, workflowId, id))
							);
							if (delay > 0) {
								yield* Effect.promise(() => step.sleep(`${label}: deferred ${attempt}`, delay));
								continue;
							}
							// Events are hints; the journal, never the event payload, decides progress.
							yield* Effect.promise(() =>
								step.waitForEvent(`${label}: wait ${attempt}`, { type: id, timeout: '1 hour' })
							).pipe(
								Effect.catchCause(cause => {
									const error = Cause.squash(cause);
									// Recover a missed GitHub webhook or a delayed publication independently.
									return error instanceof Error && error.name === 'WorkflowTimeoutError'
										? Effect.void
										: Effect.die(error);
								}),
							);
						}
					});
				const run = (id: string): Effect.Effect<void> =>
					Effect.gen(function*() {
						const existing = pending.get(id);
						if (existing) return yield* existing;
						const operation = operations.find(operation => operation.id === id);
						if (!operation) return yield* Effect.die(new Error('Release dependency is missing'));
						const once = yield* Effect.cached(Effect.gen(function*() {
							yield* Effect.forEach(operation.dependencies, run, { concurrency: 'unbounded', discard: true });
							if (operation.paced) {
								const wait = yield* Effect.promise(() =>
									step.do(
										`${operation.operation}: reserve`,
										() => coordinator.reservePublication(preparationId, workflowId, id),
									)
								);
								if (wait > 0) yield* Effect.promise(() => step.sleep(`${operation.operation}: paced`, wait));
							}
							yield* advance(id, operation.operation);
						}));
						pending.set(id, once);
						return yield* once;
					});
				yield* Effect.forEach(operations, operation => run(operation.id), { concurrency: 'unbounded', discard: true });
				yield* Effect.promise(() =>
					step.do('Complete release', () => coordinator.completeReleaseWorkflow(preparationId, workflowId))
				);
				return { preparationId, operations: operations.map(operation => operation.id) };
			}).pipe(
				Effect.tapCause(() =>
					Effect.promise(() =>
						step.do(
							'Record coordination failure',
							() => coordinator.releaseWorkflowInterrupted(preparationId, workflowId),
						)
					)
				),
			),
		);
	}
}
