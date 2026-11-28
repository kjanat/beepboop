import { Clock, Context, Effect, Layer } from 'effect';
import { GitHubReleases } from '@/automation/github-releases.ts';
import { PublicationRecheck } from '@/automation/publication-recheck.ts';
import { RefPublication } from '@/automation/ref-publication.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import { runJobs } from '@/automation/run-jobs.ts';
import { Automation } from '@/automation/service.ts';
import { workflowPath } from '@/domain/workflow-path.ts';
import type { WorkflowRun } from '@/github/resources.ts';
import { dispatchSchema, workflowRunSchema, workflowRunsSchema } from '@/github/resources.ts';
import type { GitHubRunResult } from '@/github/run-state.ts';
import { classifyRun } from '@/github/run-state.ts';
import { GitHubRejection } from '@/github/transport.ts';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logFailure } from '@/kernel/logging/failure-log.ts';
import { LedgerStore } from '@/publication/ledger/service.ts';
import { released } from '@/publication/ledger.ts';
import type { Publication } from '@/publication/publication.ts';
import {
	dependenciesReady,
	expectedRunTitle,
	recheckable,
	reopened,
	runTitle,
	settleRun,
} from '@/release/domain/execution/execution.ts';
import { resolveInputs } from '@/release/domain/execution/outputs.ts';
import { githubFailureReason } from '@/release/domain/execution/run-labels.ts';
import { runningStates } from '@/release/domain/execution/states.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

const automaticRetries = 3;

export class Dispatcher extends Context.Service<Dispatcher, {
	readonly dispatch: (
		execution: Execution,
		executions: Execution[],
		active: Execution[],
		busy: Set<string>,
	) => Effect.Effect<void, DomainError>;
	readonly redispatch: (
		execution: Execution,
		publications: Publication[],
		requested: string,
	) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/Dispatcher') {
	static readonly layer = Layer.effect(
		Dispatcher,
		Effect.gen(function*() {
			const { gateway } = yield* Automation;
			const executions = yield* Executions;
			const commits = yield* ReleaseCommits;
			const refs = yield* RefPublication;
			const releases = yield* GitHubReleases;
			const sets = yield* ReleaseSets;
			const ledgers = yield* LedgerStore;
			const planner = yield* AlarmPlanner;
			const recheck = yield* PublicationRecheck;

			const redispatch = Effect.fnUntraced(function*(
				execution: Execution,
				publications: Publication[],
				requested: string,
			) {
				const clock = yield* Clock.Clock;
				const token = yield* gateway.token(execution.repository, execution.repositoryId, {
					contents: 'read',
					actions: 'write',
				});
				const run = execution.runId
					? yield* gateway.read(
						workflowRunSchema,
						`/repos/${execution.repository}/actions/runs/${execution.runId}`,
						token,
					)
					: null;
				const moved = yield* commits.moved(
					execution,
					token,
					typeof run?.head_branch === 'string' ? run.head_branch : undefined,
				);
				if (
					moved
					&& !(run !== null && run.head_sha === execution.sourceSha && (yield* refs.versionTagged(execution)))
				) return yield* precondition(moved);
				if (run !== null && execution.eventId.startsWith('observed:') && run.conclusion === 'success') {
					return yield* precondition(
						`Workflow run ${run.id} succeeded, so it has no failed jobs to re-run. Fix the reported problem and re-run the workflow on GitHub`,
					);
				}
				if (run !== null && (run.head_sha === execution.sourceSha || execution.currentWorkflow)) {
					yield* gateway.call(
						`/repos/${execution.repository}/actions/runs/${execution.runId}/rerun-failed-jobs`,
						token,
						'POST',
					);
					yield* executions.put({
						...execution,
						state: 'uncertain',
						github: undefined,
						cancelledBy: undefined,
						runAttempt: run.run_attempt,
						reason: `${requested}; re-running the failed jobs`,
						publications,
					});
				} else {
					yield* executions.put({
						...execution,
						state: 'ready',
						cancelledBy: undefined,
						supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
						runId: undefined,
						runAttempt: undefined,
						github: undefined,
						workflowSha: undefined,
						reason: `${requested}; dispatching a new run`,
						publications,
					});
				}
				yield* planner.requestReconcile(clock.currentTimeMillisUnsafe());
			});
			const retryable = Effect.fnUntraced(function*(
				execution: Execution,
				run: Pick<WorkflowRun, 'id' | 'run_attempt'>,
				result: GitHubRunResult,
			) {
				// Classify GitHub first: ledger evidence must never override cancellation,
				// action required, a startup failure, or incomplete/unknown job evidence.
				if (!result.retry) return false;
				const ledger = yield* ledgers.get(execution.id);
				if (ledger === undefined) return result.retry === 'runner-unassigned';
				const open = ledger.records.filter(record =>
					record.required && !released(record) && record.status.state !== 'uploaded'
				);
				if (!open.length) return false;
				const holder = `${run.id}:${run.run_attempt}`;
				return open.every(record =>
					(record.status.state === 'failed-retryable' && record.status.holder === holder)
					|| (result.retry === 'runner-unassigned' && record.status.state === 'planned')
				);
			});
			const dispatch = Effect.fnUntraced(function*(
				execution: Execution,
				all: Execution[],
				active: Execution[],
				busy: Set<string>,
			) {
				const clock = yield* Clock.Clock;
				const workflow = execution.workflow;
				if (!workflow) return yield* precondition('Execution has no runner');
				const token = yield* gateway.token(execution.repository, execution.repositoryId, {
					contents: 'read',
					actions: 'write',
				});
				if (execution.runId) {
					const runId = execution.runId;
					const run = yield* gateway.read(
						workflowRunSchema,
						`/repos/${execution.repository}/actions/runs/${runId}`,
						token,
					);
					if (run.repository.id !== execution.repositoryId || run.path !== workflowPath(workflow.file)) {
						return yield* precondition('Run identity changed');
					}
					const runAttempt = run.run_attempt;
					if (
						run.status === 'completed' && execution.state === 'uncertain' && !execution.github
						&& runAttempt <= (execution.runAttempt ?? 0)
						&& !execution.publications.some(recheckable)
					) {
						return;
					}
					const result = classifyRun(
						run,
						run.status === 'completed' ? yield* runJobs(gateway, execution.repository, run, token) : [],
					);
					if (result.observation.completed) {
						yield* recheck.probe(execution);
						const limited = execution.publications.flatMap(publication =>
							publication.outcome === 'rate-limited' ? [Date.parse(publication.retryAfter)] : []
						);
						if (
							limited.length && (result.retry || result.observation.kind === 'succeeded'
								|| (!result.jobs.length && ['failed', 'timed-out'].includes(result.observation.kind)))
						) {
							yield* sets.rateLimited(execution, runId, limited);
							return;
						}
						const settled = settleRun(execution, result);
						if (
							settled.state === 'failed' && runAttempt <= automaticRetries
							&& (yield* retryable(execution, run, result))
						) {
							const retried = yield* Effect.result(redispatch(
								{ ...execution, runAttempt },
								reopened(execution.publications),
								`Attempt ${runAttempt}: ${githubFailureReason(result)}; retrying open publications`,
							));
							if (retried._tag === 'Success') return;
						}
						const ended = {
							...settled,
							runAttempt: execution.workflow?.refs?.distribution && !execution.refPlan
								? execution.runAttempt
								: runAttempt,
						};
						yield* executions.put(
							yield* releases.published(ended).pipe(
								recover(error =>
									logFailure('release.recheck-failed', error, { executionId: ended.id }).pipe(Effect.as(ended))
								),
							),
						);
					} else {
						const next = { ...settleRun(execution, result), runAttempt };
						if (
							next.state !== execution.state || next.reason !== execution.reason || runAttempt !== execution.runAttempt
							|| JSON.stringify(next.github) !== JSON.stringify(execution.github)
						) yield* executions.put(next);
					}
					return;
				}
				if (['dispatching', 'uncertain'].includes(execution.state)) {
					const data = yield* gateway.read(
						workflowRunsSchema,
						`/repos/${execution.repository}/actions/workflows/${workflow.file}/runs?event=workflow_dispatch&per_page=100`,
						token,
					);
					const matches = data.workflow_runs.filter(
						(run) =>
							run.display_title === expectedRunTitle(execution)
							&& run.path === workflowPath(workflow.file)
							&& run.head_branch === workflow.ref?.replace(/^refs\/(heads|tags)\//, '')
							&& run.repository.id === execution.repositoryId
							&& !execution.supersededRuns?.includes(run.id),
					);
					const run = matches.length === 1 ? matches[0] : undefined;
					if (run) {
						yield* executions.put({
							...execution,
							state: 'running',
							runId: run.id,
							runAttempt: run.run_attempt,
							workflowSha: undefined,
						});
					} else {
						yield* executions.put({
							...execution,
							state: 'uncertain',
							reason: matches.length
								? 'Multiple matching runs require review'
								: 'Dispatch outcome awaiting reconciliation',
						});
					}
					return;
				}
				if (!dependenciesReady(execution, all) || (execution.notBefore ?? 0) > clock.currentTimeMillisUnsafe()) {
					return;
				}
				if (busy.has(execution.stream)) {
					const releaseId = execution.releaseSet?.workflowId;
					// Independent operations within one frozen release may run together.
					// Other releases and legacy executions still own the stream exclusively.
					if (
						!releaseId || active.some(other =>
							other.stream === execution.stream
							&& runningStates.includes(other.state)
							&& other.releaseSet?.workflowId !== releaseId
						)
					) return;
				}
				const reason = yield* commits.moved(execution, token);
				if (reason) {
					yield* executions.put({ ...execution, state: 'failed', reason });
					return;
				}
				execution.resolvedInputs = yield* resolveInputs(execution, all);
				const draftRelease = yield* releases.draft(execution);
				if (draftRelease) execution.draftRelease = draftRelease;
				busy.add(execution.stream);
				yield* executions.put({
					...execution,
					state: 'dispatching',
					attempts: execution.attempts + 1,
					dispatchedAt: clock.currentTimeMillisUnsafe(),
				});
				const dispatched = yield* Effect.result(gateway.read(
					dispatchSchema,
					`/repos/${execution.repository}/actions/workflows/${workflow.file}/dispatches`,
					token,
					'POST',
					{
						ref: workflow.ref,
						inputs: {
							...workflow.inputs,
							...(execution.package ? { package: execution.package.id } : {}),
							...(execution.titled ? { beepboop_title: runTitle(execution) } : {}),
							beepboop_execution_id: execution.id,
						},
					},
				));
				if (dispatched._tag === 'Failure') {
					const error = dispatched.failure;
					if (!(error instanceof GitHubRejection)) return yield* error;
					yield* executions.put({
						...execution,
						state: error.retryAt === undefined ? 'failed' : 'ready',
						attempts: execution.attempts + 1,
						notBefore: error.retryAt,
						reason: `Dispatch rejected: ${decodeError(error)}`,
					});
					return;
				}
				const runId = dispatched.success?.workflow_run_id;
				if (runId) {
					yield* executions.put({ ...execution, state: 'running', attempts: execution.attempts + 1, runId });
				}
			});

			return Dispatcher.of({
				dispatch: (execution, all, active, busy) =>
					dispatch(execution, all, active, busy).pipe(
						recover(error =>
							Effect.gen(function*() {
								const reason = `Beepboop could not continue: ${decodeError(error)}`;
								const current = yield* executions.get(execution.id);
								if (current.reason !== reason) yield* executions.put({ ...current, reason });
							})
						),
					),
				redispatch,
			});
		}),
	);
}
