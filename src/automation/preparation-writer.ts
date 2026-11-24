import { Context, Effect, Layer, Match } from 'effect';
import {
	commitVersion,
	enableAutoMerge,
	pullRequest,
	resumePreparation,
} from '@/automation/preparation-pull-requests.ts';
import { Automation } from '@/automation/service.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { retryTransient } from '@/kernel/http/retry.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import type { Execution, PreparationResult } from '@/release/domain/execution/types.ts';
import type { PreparationRequest } from '@/release/domain/preparation-request.ts';
import { Background } from '@/release/services/coordinator/background.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export class PreparationWriter extends Context.Service<PreparationWriter, {
	readonly submit: (request: PreparationRequest) => Effect.Effect<PreparationResult, DomainError>;
}>()('beepboop/automation/PreparationWriter') {
	static readonly layer = Layer.effect(
		PreparationWriter,
		Effect.gen(function*() {
			const { gateway } = yield* Automation;
			const executions = yield* Executions;
			const lock = yield* CoordinatorLock;
			const background = yield* Background;
			const autoMerge = (execution: Execution, result: PreparationResult) => {
				const method = execution.versionPrMerge
					?? execution.configuration.streams[execution.stream]?.prepare.versionPrMerge;
				if (result.kind === 'commit' || result.autoMerge || !method || method === 'manual') return Effect.void;
				return background.fork(
					enableAutoMerge(gateway, execution.repository, execution.repositoryId, result.url, method, 'version PR').pipe(
						retryTransient<DomainError>({
							attempts: 3,
							delay: 1000,
							while: error => error.problem.code === 'upstream',
						}),
						Effect.flatMap(merge =>
							lock.serialized(Effect.gen(function*() {
								const current = yield* executions.get(execution.id);
								const preparation = current.prepared ?? current.managed;
								if (preparation?.result?.head !== result.head) return;
								preparation.result = { ...result, autoMerge: merge };
								yield* executions.put(current);
							}))
						),
						logRecovered('preparation.auto-merge-failed', { executionId: execution.id, url: result.url }),
					),
				);
			};
			const write = (request: PreparationRequest): Effect.Effect<PreparationResult, DomainError> => {
				const checkpoint = (head: string) => {
					request.preparation.head = head;
					return executions.put(request.execution);
				};
				return Match.valueTags(request, {
					CommitVersion: ({ snapshot, message, edits, head }) =>
						commitVersion(gateway, snapshot, message, edits, head, checkpoint),
					ResumePullRequest: ({ snapshot, branch, title, body, head }) =>
						resumePreparation(gateway, snapshot, branch, title, body, head),
					OpenPullRequest: ({ snapshot, branch, title, body, edits, coAuthored }) =>
						pullRequest(gateway, { snapshot, branch, title, body, edits, checkpoint, coAuthored }),
				});
			};
			return PreparationWriter.of({
				submit: request => write(request).pipe(Effect.tap(result => autoMerge(request.execution, result))),
			});
		}),
	);
}
