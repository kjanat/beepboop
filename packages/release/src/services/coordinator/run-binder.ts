import { Context, Effect, Layer } from 'effect';
import type { RunExpectation, RunIdentity } from '@/auth/actions-oidc.ts';
import { WorkflowRunGuard } from '@/auth/actions-oidc.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export type BindExpectation = RunExpectation | { readonly _tag: 'NewRun' };

export interface BoundRun {
	readonly execution: Execution;
	readonly workflow: NonNullable<Execution['workflow']>;
}

export class RunBinder extends Context.Service<RunBinder, {
	readonly bind: (
		id: string,
		identity: RunIdentity,
		expectation: BindExpectation,
	) => Effect.Effect<BoundRun, DomainError>;
}>()('beepboopbot/release/RunBinder') {
	static readonly layer = Layer.effect(
		RunBinder,
		Effect.gen(function*() {
			const executions = yield* Executions;
			return RunBinder.of({
				bind: Effect.fnUntraced(function*(id: string, identity: RunIdentity, expectation: BindExpectation) {
					const execution = yield* executions.get(id);
					const workflow = execution.workflow;
					if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
					if (expectation._tag !== 'NewRun') yield* WorkflowRunGuard.require(execution, identity, expectation);
					return { execution, workflow };
				}),
			});
		}),
	);
}
