import { Context, Effect, Layer } from 'effect';
import { PreparationWriter } from '@/automation/preparation-writer.ts';
import { Automation } from '@/automation/service.ts';
import { repositorySnapshot } from '@/automation/snapshot.ts';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { landsByCommit, preparationRequest } from '@/release/domain/preparation-request.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export class ManagedPreparation extends Context.Service<ManagedPreparation, {
	readonly run: (execution: Execution) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/ManagedPreparation') {
	static readonly layer = Layer.effect(
		ManagedPreparation,
		Effect.gen(function*() {
			const { gateway } = yield* Automation;
			const executions = yield* Executions;
			const writer = yield* PreparationWriter;
			return ManagedPreparation.of({
				run: Effect.fnUntraced(function*(execution: Execution) {
					const operation = execution.managed;
					if (!operation || execution.workflow) return yield* precondition('Invalid managed operation');
					yield* Effect.gen(function*() {
						if (operation.result) {
							yield* executions.put({ ...execution, state: 'succeeded' });
							return;
						}
						if (operation.plan.requiresPreparation || operation.plan.sourceSha !== execution.sourceSha) {
							return yield* precondition('Managed preparation plan is not executable');
						}
						const snapshot = yield* repositorySnapshot(
							gateway,
							execution.repository,
							execution.repositoryId,
							execution.sourceSha,
							operation.plan.edits.map(edit => edit.path),
						);
						execution.state = 'running';
						execution.attempts++;
						yield* executions.put(execution);
						operation.result = yield* writer.submit(
							preparationRequest(execution, operation, snapshot, {
								branch: operation.branch,
								title: operation.title,
								body: operation.body,
								edits: operation.plan.edits,
							}),
						);
						execution.state = 'succeeded';
						delete execution.reason;
						yield* executions.put(execution);
					}).pipe(
						recover(error =>
							executions.put({
								...execution,
								state: landsByCommit(execution) && error.problem.code === 'precondition' ? 'failed' : 'uncertain',
								reason: decodeError(error),
							})
						),
					);
				}),
			});
		}),
	);
}
