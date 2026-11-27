import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { ApprovalGate } from '@/automation/approval-gate.ts';
import { Dispatcher } from '@/automation/dispatcher.ts';
import { GitHubReleases } from '@/automation/github-releases.ts';
import { restatePreparation } from '@/automation/preparation-pull-requests';
import { RefPublication } from '@/automation/ref-publication.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import { runJobs } from '@/automation/run-jobs.ts';
import { Automation } from '@/automation/service.ts';
import { wakeUp } from '@/automation/wake-up.ts';
import type { BinaryProgress } from '@/contract/views';
import { releaseSchema, workflowRunSchema } from '@/github/resources.ts';
import { classifyJob, jobProgressState } from '@/github/run-state.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { approvalShaPattern } from '@/kernel/schema/ids.ts';
import { matches, sha } from '@/kernel/schema/result.ts';
import type { Committed } from '@/persistence/durable/journal.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { identifyExecution } from '@/release/domain/execution/codec-v1.ts';
import { deriveExecution, recoverable, reopened } from '@/release/domain/execution/execution.ts';
import type { Execution, PreparedRelease, ReleaseStarted } from '@/release/domain/execution/types.ts';
import { preparationBody } from '@/release/domain/managed.ts';
import { promotionOperations } from '@/release/domain/planning/promotion-operations.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { Background } from '@/release/services/coordinator/background.ts';
import { Executions, RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import { binaryLegs } from '@/setup/workflows/binaries.ts';

export type RecoveryAction = 'reconcile' | 'retry' | 'redispatch';

function freshRun(execution: Execution, workflow: Execution['workflow']): Execution {
	return {
		...execution,
		state: 'ready',
		supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
		runId: undefined,
		runAttempt: undefined,
		github: undefined,
		workflowSha: undefined,
		artifacts: execution.artifacts.filter(artifact => artifact.runId !== execution.runId),
		...(workflow ? { workflow } : {}),
		publications: reopened(execution.publications),
	};
}
function startedPreparation(prior: Execution, started: ReleaseStarted): Execution {
	const upgraded: Execution = { ...prior, started };
	if (upgraded.managed) {
		upgraded.managed = {
			...upgraded.managed,
			body: upgraded.managed.body.replace(preparationBody(prior), preparationBody(upgraded)),
		};
	}
	return upgraded;
}

export class ExecutionControl extends Context.Service<ExecutionControl, {
	readonly execution: (id: string) => Effect.Effect<Execution | undefined, DomainError>;
	readonly preparationVersions: (stream: string) => Effect.Effect<string[], DomainError>;
	readonly preparationResults: (stream: string, version: string) => Effect.Effect<PreparedRelease[], DomainError>;
	readonly promotions: (stream: string, version: string) => Effect.Effect<Execution[], DomainError>;
	readonly reindex: (repositoryId: number) => Effect.Effect<number, DomainError>;
	readonly exportJournal: Effect.Effect<{ key: string; value: unknown }[], DomainError>;
	readonly openSubscriptionIssue: (
		repository: string,
		repositoryId: number,
		id: string,
		issue: { title: string; body: string },
	) => Effect.Effect<void, DomainError>;
	readonly enqueue: (execution: Execution) => Effect.Effect<Execution, DomainError>;
	readonly approve: (
		id: string,
		commitSha: string,
		actor: string,
		force: boolean,
	) => Effect.Effect<Execution, DomainError>;
	readonly approvalReadiness: (id: string) => Effect.Effect<{ problems: string[]; blocked: string[] }, DomainError>;
	readonly binaryProgress: (id: string) => Effect.Effect<BinaryProgress, DomainError>;
	readonly recover: (id: string, action: RecoveryAction, actor: string) => Effect.Effect<Execution, DomainError>;
	readonly cancel: (id: string, actor: string) => Effect.Effect<Execution, DomainError>;
	readonly wake: Effect.Effect<void, DomainError>;
}>()('beepboop/automation/ExecutionControl') {
	static readonly layer = Layer.effect(
		ExecutionControl,
		Effect.gen(function*() {
			const { gateway, store } = yield* Automation;
			const storage = yield* DurableStorage;
			const journal = yield* Journal;
			const executions = yield* Executions;
			const revisions = yield* RepositoryRevisions;
			const planner = yield* AlarmPlanner;
			const background = yield* Background;
			const sets = yield* ReleaseSets;
			const gate = yield* ApprovalGate;
			const commits = yield* ReleaseCommits;
			const refs = yield* RefPublication;
			const releases = yield* GitHubReleases;
			const dispatcher = yield* Dispatcher;
			const wake = wakeUp(sets, planner);

			const storePromotionPlan = Effect.fnUntraced(function*(promotion: Execution, existing: boolean) {
				if (promotion.operation !== 'promote' || promotion.releaseSet || !promotion.eventId.startsWith('release:')) {
					return false;
				}
				const stream = promotion.configuration.streams[promotion.stream];
				if (!stream) return yield* precondition('Unknown promotion stream');
				const operations = yield* Effect.fromResult(promotionOperations(stream));
				if (!operations.length) return false;
				const repository = yield* revisions.get(promotion.repositoryId);
				if (!repository) return yield* precondition('Promotion repository unavailable');
				const revision = {
					defaultBranch: repository.defaultBranch,
					inventory: yield* revisions.inventoryAt(promotion),
				};
				const entries: Committed[] = [];
				for (const operation of operations) {
					const member = yield* deriveExecution(promotion, revision, {
						operation,
						stream: promotion.stream,
						eventId: promotion.eventId,
						sourceSha: promotion.sourceSha,
						version: promotion.version,
					});
					if (!(yield* executions.stored(member.id))) {
						entries.push({
							entity: 'execution',
							id: member.id,
							repositoryId: member.repositoryId,
							value: identifyExecution(member),
						});
					}
				}
				if (!existing) {
					entries.unshift({
						entity: 'execution',
						id: promotion.id,
						repositoryId: promotion.repositoryId,
						value: identifyExecution(promotion),
					});
				}
				const [first, ...rest] = entries;
				if (first) {
					yield* executions.commit([first, ...rest], [yield* planner.reconcileWrite(yield* Clock.currentTimeMillis)]);
				}
				return true;
			});

			const supersedePending = Effect.fnUntraced(function*(execution: Execution) {
				if (execution.configuration.streams[execution.stream]?.concurrency !== 'supersede-pending') return;
				for (const old of yield* executions.all) {
					if (
						old.id !== execution.id && old.stream === execution.stream && old.operation === execution.operation
						&& ['pending', 'ready'].includes(old.state)
					) {
						yield* executions.put({ ...old, state: 'cancelled', reason: 'Superseded before dispatch' });
					}
				}
			});
			const restate = Effect.fnUntraced(function*(prior: Execution, upgraded: Execution) {
				const previous = preparationBody(prior);
				const next = preparationBody(upgraded);
				const result = upgraded.prepared?.result ?? upgraded.managed?.result;
				if (result && result.kind !== 'commit' && previous !== next) {
					const work = restatePreparation(
						gateway,
						upgraded.repository,
						upgraded.repositoryId,
						result.url,
						previous,
						next,
					).pipe(logRecovered('preparation.restate-failed', { executionId: upgraded.id, url: result.url }));
					yield* background.fork(work);
				}
			});
			const restartPreparation = Effect.fnUntraced(function*(prior: Execution, started: ReleaseStarted) {
				const upgraded = startedPreparation(prior, prior.started?.force ? { ...started, force: true } : started);
				yield* dispatcher.redispatch(upgraded, reopened(upgraded.publications), 'Start requested');
				yield* supersedePending(upgraded);
				yield* restate(prior, upgraded);
				return yield* executions.get(upgraded.id);
			});
			const restartRelease = Effect.fnUntraced(function*(prior: Execution, request: Execution) {
				const force = request.started?.force === true;
				if (!['failed', 'cancelled', 'awaiting-approval'].includes(prior.state)) return prior;
				if (prior.state === 'awaiting-approval' && !force) return prior;
				const started: Execution = {
					...prior,
					approvedBy: 'start',
					...(request.started ? { started: request.started } : {}),
					...(request.initiatedBy ? { initiatedBy: request.initiatedBy } : {}),
				};
				if (prior.state !== 'awaiting-approval' && (prior.attempts > 0 || prior.approvedAt !== undefined)) {
					if (!force) return prior;
					if (!prior.workflow) {
						yield* dispatcher.redispatch(started, reopened(prior.publications), 'Forced restart');
						return yield* executions.get(prior.id);
					}
					const rerun: Execution = {
						...freshRun(started, prior.workflow),
						reason: `Dispatching ${prior.workflow.file} again for ${prior.sourceSha.slice(0, 12)}`,
					};
					yield* executions.put(rerun);
					yield* wake;
					return rerun;
				}
				const waiting: Execution = {
					...started,
					state: 'awaiting-approval',
					publications: reopened(prior.publications),
				};
				delete waiting.reason;
				yield* executions.put(waiting);
				yield* wake;
				return waiting;
			});
			const dispatchCurrentWorkflow = Effect.fnUntraced(function*(execution: Execution) {
				const clock = yield* Clock.Clock;
				if (execution.operation !== 'promote' || !['failed', 'cancelled'].includes(execution.state)) {
					return yield* precondition('Only a failed or cancelled promotion can run the current workflow');
				}
				if (execution.attempts === 0 && execution.approvedAt === undefined) {
					return yield* precondition('Publish this promotion first; it never ran');
				}
				const record = yield* store.repositories.get(execution.repositoryId);
				const current = record
					&& (record.configuration?.streams[execution.stream]?.promote.workflow?.ref ?? record.defaultBranch);
				const workflow = execution.workflow && current && current !== execution.workflow.ref
					? { ...execution.workflow, ref: current }
					: execution.workflow;
				if (!(yield* refs.versionTagged(execution))) {
					return yield* precondition(
						`The version tags of ${execution.version ?? 'this release'} do not all target ${
							execution.sourceSha.slice(0, 12)
						}; retry the operation instead`,
					);
				}
				yield* executions.put({
					...freshRun(execution, workflow),
					currentWorkflow: true,
					reason: `Dispatching the current ${execution.workflow?.file ?? 'workflow'} for ${
						execution.sourceSha.slice(0, 12)
					}`,
				});
				yield* planner.requestReconcile(clock.currentTimeMillisUnsafe());
			});

			return ExecutionControl.of({
				execution: executions.stored,
				preparationVersions: stream =>
					executions.all.pipe(
						Effect.map(all => [
							...new Set(
								all.flatMap(execution =>
									execution.stream === stream && execution.state === 'succeeded' && execution.version
										&& (execution.prepared?.result || execution.managed?.result)
										? [execution.version]
										: []
								),
							),
						]),
					),
				preparationResults: (stream, version) =>
					executions.all.pipe(Effect.map(all =>
						all.flatMap(execution => {
							const result = execution.prepared?.result ?? execution.managed?.result;
							return result && execution.stream === stream && execution.version === version
									&& execution.state === 'succeeded'
								? [{ ...result, ...(execution.started ? { started: execution.started } : {}) }]
								: [];
						})
					)),
				promotions: (stream, version) =>
					executions.all.pipe(Effect.map(all =>
						all
							.filter(execution =>
								execution.operation === 'promote' && execution.stream === stream && execution.version === version
							)
							.sort((left, right) => right.createdAt - left.createdAt)
					)),
				reindex: repositoryId => journal.reindex(repositoryId),
				exportJournal: storage.dump,
				openSubscriptionIssue: Effect.fnUntraced(function*(
					repository: string,
					repositoryId: number,
					id: string,
					issue: { title: string; body: string },
				) {
					if ((yield* storage.find(Keys.subscriptionIssue, id))?.kind === 'readable') return;
					yield* gateway.ensureIssue(repository, repositoryId, issue);
					yield* storage.put(Keys.subscriptionIssue, id, true);
				}),
				enqueue: Effect.fnUntraced(function*(execution: Execution) {
					if (Boolean(execution.workflow) === Boolean(execution.managed)) {
						return yield* precondition('Execution needs exactly one runner');
					}
					const prior = yield* executions.stored(execution.id);
					if (prior?.operation === 'prepare' && prior.versionPrMerge !== execution.versionPrMerge) {
						return yield* precondition(
							`${execution.version} of ${execution.stream} is already being prepared with versionPrMerge ${
								prior.versionPrMerge ?? 'from the stream'
							}`,
						);
					}
					if (
						prior?.state === 'awaiting-approval' && prior.approvedBy === undefined && execution.approvedBy === 'start'
					) {
						const started: Execution = {
							...prior,
							approvedBy: execution.approvedBy,
							...(execution.started ? { started: execution.started } : {}),
							...(execution.initiatedBy ? { initiatedBy: execution.initiatedBy } : {}),
						};
						yield* executions.put(started);
						return started;
					}
					if (prior?.operation === 'promote' && execution.approvedBy === 'start') {
						return yield* restartRelease(prior, execution);
					}
					if (prior?.operation === 'prepare' && execution.started && ['failed', 'cancelled'].includes(prior.state)) {
						return yield* restartPreparation(prior, execution.started);
					}
					if (
						prior?.operation === 'prepare' && execution.started
						&& (!prior.started || (execution.started.force && !prior.started.force))
					) {
						const upgraded = startedPreparation(prior, execution.started);
						yield* executions.put(upgraded);
						yield* restate(prior, upgraded);
						return upgraded;
					}
					if (prior) return prior;
					yield* supersedePending(execution);
					if (!(yield* storePromotionPlan(execution, false))) yield* executions.put(execution);
					return execution;
				}),
				approve: Effect.fnUntraced(function*(id: string, commitSha: string, actor: string, force: boolean) {
					const execution = yield* executions.get(id);
					const reference = yield* Effect.fromResult(matches(commitSha, approvalShaPattern));
					const commit = yield* Effect.fromResult(sha(execution.sourceSha));
					if (execution.state !== 'awaiting-approval' || !commit.startsWith(reference)) {
						return yield* precondition('This release is not waiting for you to publish that commit');
					}
					const token = yield* gateway.token(execution.repository, execution.repositoryId);
					const head = yield* commits.head(execution, token);
					if (
						head
						&& (head.tag
							? head.sha !== execution.sourceSha
							: !(yield* commits.contains(execution, head.sha, token)))
					) {
						return yield* precondition(
							`${head.ref} is at ${head.sha.slice(0, 12)}. Publish the release for that commit.`,
						);
					}
					const conflict = yield* refs.tagProblem(execution, true);
					if (conflict) return yield* precondition(conflict);
					const incomplete = yield* gate.metadataBlocks(execution);
					if (incomplete.length) return yield* precondition(incomplete.join('; '));
					const checks = yield* gate.checks(execution);
					const problems = [...checks.failed, ...checks.pending];
					if (problems.length && !force) return yield* precondition(problems.join('; '));
					return yield* gate.admit(
						execution,
						actor,
						`${id}:${commit}${problems.length ? ` overriding: ${problems.join('; ')}` : ''}${
							checks.skipped.length ? ` skipping: ${checks.skipped.join('; ')}` : ''
						}`,
					);
				}),
				approvalReadiness: Effect.fnUntraced(function*(id: string) {
					const execution = yield* executions.get(id);
					if (execution.state !== 'awaiting-approval') {
						return { problems: [], blocked: ['This release is not waiting for you to publish it'] };
					}
					const [conflict, incomplete, problems] = yield* Effect.all([
						refs.tagProblem(execution),
						gate.metadataBlocks(execution),
						Effect.result(gate.problems(execution)),
					], { concurrency: 'unbounded' });
					if (conflict) return { problems: [], blocked: [`${conflict}. Release a new version.`] };
					if (incomplete.length) return { problems: [], blocked: incomplete };
					return { problems: yield* Effect.fromResult(problems), blocked: [] };
				}),
				binaryProgress: Effect.fnUntraced(function*(id: string) {
					const execution = yield* executions.get(id);
					const release = execution.workflow?.setup?.binaries;
					if (!release || !execution.version) return { legs: [], assets: [] };
					const legs = binaryLegs(release, execution.version);
					const token = yield* gateway.token(execution.repository, execution.repositoryId, { actions: 'read' });
					const jobs = execution.runId
						? (yield* runJobs(
							gateway,
							execution.repository,
							{ id: execution.runId, run_attempt: execution.runAttempt ?? 1 },
							token,
						))
						: [];
					const draft = execution.draftRelease;
					const uploaded = new Set(
						draft
							? (yield* gateway.read(
								Schema.NullOr(releaseSchema),
								`/repos/${execution.repository}/releases/${draft.id}`,
								yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'write' }),
							))?.assets.map(asset => asset.name) ?? []
							: [],
					);
					return {
						legs: legs.map(leg => {
							const job = jobs.find(entry => entry.name === leg.job);
							const kind = job ? classifyJob(job).kind : 'waiting';
							return {
								build: leg.build,
								target: leg.target,
								job: leg.job,
								state: jobProgressState(kind, job?.status === 'completed'),
								kind,
								...(job ? { status: job.status, conclusion: job.conclusion } : {}),
								...(job?.started_at ? { startedAt: job.started_at } : {}),
								...(job?.completed_at ? { completedAt: job.completed_at } : {}),
							};
						}),
						assets: legs.map(leg => ({
							build: leg.build,
							target: leg.target,
							name: leg.asset,
							uploaded: uploaded.has(leg.asset),
						})),
					} satisfies BinaryProgress;
				}),
				recover: Effect.fnUntraced(function*(id: string, action: RecoveryAction, actor: string) {
					const clock = yield* Clock.Clock;
					if (action === 'reconcile') yield* storage.remove(Keys.quarantine, id);
					const execution = yield* executions.get(id);
					const takeover = action === 'reconcile' || execution.operation !== 'promote'
						? undefined
						: (yield* executions.all).find(other =>
							other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
							&& other.version === execution.version && (other.reclaims?.length ?? 0) > 0
							&& !['failed', 'cancelled'].includes(other.state)
						);
					if (takeover) {
						return yield* precondition(
							`Release ${takeover.id} takes over the version tag of ${execution.version}; retry that release instead`,
						);
					}
					if (action === 'redispatch') yield* dispatchCurrentWorkflow(execution);
					else if (action === 'retry') {
						if (!['failed', 'cancelled'].includes(execution.state)) {
							return yield* precondition('Only failed or cancelled operations can be retried');
						}
						if (execution.operation === 'prepare' && !execution.plan && !execution.managed) {
							return yield* precondition('This preparation has no plan; prepare the release from Prepare a release');
						}
						if (execution.artifacts.some((a) => Date.parse(a.expiresAt) <= clock.currentTimeMillisUnsafe())) {
							return yield* precondition('Artifacts expired; use the configured preparation/recovery producer');
						}
						const publications = reopened(execution.publications);
						if (execution.operation === 'promote' && execution.attempts === 0 && execution.approvedAt === undefined) {
							const next: Execution = { ...execution, state: 'awaiting-approval', publications };
							delete next.reason;
							yield* executions.put(next);
							yield* wake;
						} else yield* dispatcher.redispatch(execution, publications, 'Retry requested');
					} else {
						const published = yield* releases.published(execution);
						if (published.state === 'succeeded') yield* storePromotionPlan(published, true);
						if (published !== execution) yield* executions.put(published);
						yield* wake;
					}
					yield* sets.resume(execution);
					yield* store.audit(actor, `execution.${action}`, id);
					return yield* executions.get(id);
				}),
				cancel: Effect.fnUntraced(function*(id: string, actor: string) {
					const execution = yield* executions.get(id);
					if (execution.state === 'succeeded' || (execution.state === 'cancelled' && !recoverable(execution))) {
						return yield* precondition('Execution has already finished');
					}
					if (execution.runId) {
						const token = yield* gateway.token(execution.repository, execution.repositoryId, {
							contents: 'read',
							actions: 'write',
						});
						const path = `/repos/${execution.repository}/actions/runs/${execution.runId}`;
						const run = yield* gateway.read(workflowRunSchema, path, token);
						if (run.status === 'completed' && run.conclusion === 'success') {
							return yield* precondition('Workflow run has already completed successfully; reconcile this operation');
						}
						if (run.status !== 'completed') {
							const cancelled = yield* Effect.result(gateway.call(`${path}/cancel`, token, 'POST'));
							const checked = yield* Effect.result(gateway.read(workflowRunSchema, path, token));
							if (
								checked._tag === 'Success' && checked.success.status === 'completed'
								&& checked.success.conclusion === 'success'
							) {
								return yield* precondition('Workflow run has already completed successfully; reconcile this operation');
							}
							if (cancelled._tag === 'Failure') return yield* cancelled.failure;
						}
					}
					const next: Execution = {
						...execution,
						state: 'cancelled',
						cancelledBy: actor,
						reason: `Cancelled by ${actor}`,
					};
					yield* executions.put(next);
					yield* store.audit(actor, 'execution.cancel', id);
					return next;
				}),
				wake,
			});
		}),
	);
}
