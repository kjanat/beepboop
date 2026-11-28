import { Clock, Context, Effect, Layer, Result } from 'effect';
import { RefPublication } from '@/automation/ref-publication.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { ReleaseSets } from '@/automation/release-sets.ts';
import { Automation } from '@/automation/service.ts';
import { wakeUp } from '@/automation/wake-up.ts';
import type { GateView, StreamGates } from '@/contract/views';
import { coversBinding } from '@/credentials/grant.ts';
import { metadataProblems } from '@/discovery/analysis/package-metadata.ts';
import type { CheckJob } from '@/discovery/workflow-analysis/deployment-jobs.ts';
import { checkJobs, deploys } from '@/discovery/workflow-analysis/deployment-jobs.ts';
import { matchesPackage, packageId, publishablePackages } from '@/domain/package-identity.ts';
import type { CheckChoice, GateSkip, ReleaseGate } from '@/domain/release-gates.ts';
import { gatedRelease, gateLabel, gateReasons, sameGate } from '@/domain/release-gates.ts';
import { releaseOperation } from '@/domain/release-operation.ts';
import { workflowPath } from '@/domain/workflow-path.ts';
import { checkRunsSchema, commitSchema, commitStatusSchema, workflowRunsSchema } from '@/github/resources.ts';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { notFound, precondition } from '@/kernel/errors/domain-error.ts';
import type { LedgerPackage } from '@/publication/contract.ts';
import { reopened } from '@/release/domain/execution/execution.ts';
import { settledStates } from '@/release/domain/execution/states.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { manifestProblems } from '@/release/domain/version.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

const metadataReason = gateReasons.metadata;
const passingConclusions = ['success', 'neutral', 'skipped'];

type GateSubject =
	& Pick<Execution, 'repository' | 'repositoryId' | 'sourceSha' | 'configuration' | 'stream'>
	& Partial<Pick<Execution, 'reruns'>>;
interface GateOutcome {
	gate: ReleaseGate;
	state: 'passed' | 'waiting' | 'failed';
	fact: string;
	detail?: string;
	run?: { id: number; done: boolean; attempt?: number };
}
interface CommitGates {
	manifest: string[];
	truncated: boolean;
	runs: number;
	outcomes: GateOutcome[];
}
export interface CommitChecks {
	pending: string[];
	failed: string[];
	skipped: string[];
}
const gateRank = { passed: 0, waiting: 1, failed: 2 } as const;
function mergedOutcomes(outcomes: readonly GateOutcome[]): GateOutcome[] {
	const merged: GateOutcome[] = [];
	for (const outcome of outcomes) {
		const index = merged.findIndex(entry => sameGate(entry.gate, outcome.gate));
		const prior = merged[index];
		if (!prior) merged.push(outcome);
		else if (gateRank[outcome.state] > gateRank[prior.state]) merged[index] = outcome;
	}
	return merged;
}
function skippedNote(gate: ReleaseGate, fact: string, skip: GateSkip): string {
	return `${gateLabel(gate)} ${fact}, skipped by ${skip.actor}`;
}

export class ApprovalGate extends Context.Service<ApprovalGate, {
	readonly problems: (execution: Execution) => Effect.Effect<string[], DomainError>;
	readonly metadataBlocks: (execution: Execution) => Effect.Effect<string[], DomainError>;
	readonly forced: (id: string, pkg: LedgerPackage) => Effect.Effect<LedgerPackage, DomainError>;
	readonly approve: (
		execution: Execution,
		actor: string,
		mode: 'immediate' | 'queue' | 'force',
	) => Effect.Effect<Execution, DomainError>;
	readonly review: (
		execution: Execution,
		executions: Execution[],
	) => Effect.Effect<'continue' | 'stop', DomainError>;
	readonly gates: (repositoryId: number, stream: string) => Effect.Effect<StreamGates, DomainError>;
	readonly resolveChecks: (id: string, choice: CheckChoice, actor: string) => Effect.Effect<Execution, DomainError>;
}>()('beepboop/automation/ApprovalGate') {
	static readonly layer = Layer.effect(
		ApprovalGate,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const { gateway, store } = automation;
			const executions = yield* Executions;
			const refs = yield* RefPublication;
			const commits = yield* ReleaseCommits;
			const sets = yield* ReleaseSets;
			const planner = yield* AlarmPlanner;

			const gateSkips = (subject: Pick<Execution, 'repositoryId' | 'stream' | 'skippedGates'>) =>
				store.gateSkips.list(subject.repositoryId, subject.stream).pipe(
					Effect.map((skips): GateSkip[] => [...skips, ...(subject.skippedGates ?? [])]),
				);
			const metadataProblemsOf = Effect.fnUntraced(function*(subject: GateSubject) {
				const record = yield* store.repositories.get(subject.repositoryId);
				if (!record) return [];
				const references = subject.configuration.streams[subject.stream]?.packages;
				return metadataProblems(record.inventory, publishablePackages(record.inventory.packages, references));
			});
			const metadataBlocks = Effect.fnUntraced(function*(execution: Execution) {
				if (execution.operation !== releaseOperation) return [];
				const skips = yield* gateSkips(execution);
				if (skips.some(skip => skip.gate.kind === 'metadata')) return [];
				return yield* metadataProblemsOf(execution);
			});
			const commitGates = Effect.fnUntraced(function*(subject: GateSubject) {
				const token = yield* gateway.token(subject.repository, subject.repositoryId);
				const base = `/repos/${subject.repository}`;
				const manifest: string[] = [];
				const repository = yield* store.repositories.get(subject.repositoryId);
				const references = subject.configuration.streams[subject.stream]?.packages;
				if (repository) {
					manifest.push(...manifestProblems(
						repository.inventory,
						repository.inventory.packages.filter(pkg =>
							!references || references.some(reference => matchesPackage(reference, pkg))
						),
					));
				}
				const [commit, checks, { workflow_runs: workflowRuns }, status] = yield* Effect.all([
					gateway.read(commitSchema, `${base}/commits/${subject.sourceSha}`, token),
					gateway.read(
						checkRunsSchema,
						`${base}/commits/${subject.sourceSha}/check-runs?per_page=100&filter=latest`,
						token,
					),
					gateway.read(
						workflowRunsSchema,
						`${base}/actions/runs?head_sha=${subject.sourceSha}&per_page=100`,
						token,
					),
					gateway.read(commitStatusSchema, `${base}/commits/${subject.sourceSha}/status`, token),
				], { concurrency: 'unbounded' });
				const verified = commit.commit.verification.verified === true;
				const outcomes: GateOutcome[] = [{
					gate: { kind: 'signature' },
					state: verified ? 'passed' : 'failed',
					fact: verified ? 'verified' : 'unverified',
				}];
				const runs = checks.check_runs;
				const releaseFiles = new Set(
					Object.values(subject.configuration.streams).flatMap(stream =>
						[stream.prepare.workflow, stream.release.workflow, ...Object.values(stream.workflows)]
							.flatMap(binding => binding ? [workflowPath(binding.file)] : [])
					),
				);
				const paths = new Map(workflowRuns.map(run => [String(run.id), run.path]));
				const statuses = new Map(workflowRuns.map(run => [String(run.id), run]));
				const runOf = (run: (typeof runs)[number]) => /\/actions\/runs\/(\d+)\//.exec(String(run.details_url))?.[1];
				const pathOf = (run: (typeof runs)[number]) => paths.get(runOf(run) ?? '');
				const unfinished = runs.filter(run => run.status !== 'completed');
				const deploying = new Map<string, CheckJob[]>();
				for (const path of new Set(unfinished.flatMap(run => pathOf(run) ?? []))) {
					if (releaseFiles.has(path)) continue;
					const source = yield* gateway.file(subject.repository, path, subject.sourceSha, token);
					deploying.set(path, source === null ? [] : checkJobs(source));
				}
				const gating = runs.filter(run => {
					const path = pathOf(run);
					if (!path) return true;
					if (releaseFiles.has(path)) return false;
					return run.status === 'completed' || !deploys(String(run.name), deploying.get(path) ?? []);
				});
				for (const run of gating) {
					const conclusion = String(run.conclusion);
					const runId = runOf(run);
					const workflowRun = statuses.get(runId ?? '');
					const runDone = workflowRun === undefined || workflowRun.status === 'completed';
					const failed = run.status === 'completed' && !passingConclusions.includes(conclusion);
					const requested = subject.reruns?.find(rerun => rerun.id === Number(runId));
					const rerunning = failed && requested !== undefined
						&& (!runDone || (workflowRun?.run_attempt ?? requested.attempt) < requested.attempt);
					outcomes.push({
						...(runId
							? {
								run: {
									id: Number(runId),
									done: runDone,
									...(workflowRun ? { attempt: workflowRun.run_attempt } : {}),
								},
							}
							: {}),
						gate: { kind: 'check', name: String(run.name) },
						state: run.status !== 'completed' || rerunning ? 'waiting' : failed ? 'failed' : 'passed',
						fact: rerunning ? 'rerunning' : run.status === 'completed' ? conclusion : 'running',
					});
				}
				if (Number(status.total_count) > 0) {
					outcomes.push({
						gate: { kind: 'status' },
						state: status.state === 'success' ? 'passed' : status.state === 'pending' ? 'waiting' : 'failed',
						fact: String(status.state),
					});
				}
				return {
					manifest,
					truncated: checks.total_count !== runs.length,
					runs: runs.length,
					outcomes,
				} satisfies CommitGates;
			});
			const commitChecks = Effect.fnUntraced(function*(execution: Execution) {
				const [{ manifest, truncated, runs, outcomes }, skips] = yield* Effect.all([
					commitGates(execution),
					gateSkips(execution),
				], { concurrency: 'unbounded' });
				const skipOf = (gate: ReleaseGate) => skips.find(skip => sameGate(skip.gate, gate));
				const kept = outcomes.filter(outcome => !skipOf(outcome.gate));
				const failed = [...manifest], pending: string[] = [];
				if (kept.some(outcome => outcome.gate.kind === 'signature' && outcome.state === 'failed')) {
					failed.push(gateReasons.signature);
				}
				if (truncated) failed.push('over 100 check runs');
				if (!runs) pending.push('no checks yet');
				else if (!outcomes.some(outcome => outcome.gate.kind === 'check')) pending.push('no verification check yet');
				const checks = kept.flatMap(outcome =>
					outcome.gate.kind === 'check' ? [{ ...outcome, name: outcome.gate.name }] : []
				);
				const running = checks.filter(check => check.state === 'waiting').map(check => check.name);
				if (running.length) pending.push(`${running.join(', ')} running`);
				const failing = checks.flatMap(check =>
					check.state !== 'failed' ? [] : [check.fact === 'failure' ? check.name : `${check.name} (${check.fact})`]
				);
				if (failing.length) failed.push(`${gateReasons.checks}${failing.join(', ')}`);
				const status = kept.find(outcome => outcome.gate.kind === 'status');
				if (status && status.state !== 'passed') {
					(status.state === 'waiting' ? pending : failed).push(`${gateReasons.status}${status.fact}`);
				}
				const skipped = mergedOutcomes(outcomes).flatMap(outcome => {
					const skip = skipOf(outcome.gate);
					return skip && outcome.state !== 'passed' ? [skippedNote(outcome.gate, outcome.fact, skip)] : [];
				});
				const metadata = skipOf({ kind: 'metadata' });
				if (metadata) {
					const incomplete = yield* metadataProblemsOf(execution);
					if (incomplete.length) skipped.push(skippedNote({ kind: 'metadata' }, 'incomplete', metadata));
				}
				return { pending, failed, skipped } satisfies CommitChecks;
			});
			const supersedeVersion = Effect.fnUntraced(function*(execution: Execution) {
				if (execution.operation !== releaseOperation || !execution.version) return;
				for (const other of yield* executions.all) {
					if (
						other.id !== execution.id && other.operation === releaseOperation && other.stream === execution.stream
						&& other.version === execution.version
						&& ['awaiting-approval', 'blocked', 'pending', 'ready', 'failed'].includes(other.state)
					) {
						yield* executions.put({ ...other, state: 'cancelled', reason: `Superseded by ${execution.id}` });
					}
				}
			});
			const admit = Effect.fnUntraced(function*(execution: Execution, actor: string, target: string) {
				const clock = yield* Clock.Clock;
				yield* store.audit(actor, 'release.approve', target);
				const next: Execution = { ...execution, state: 'ready', approvedAt: clock.currentTimeMillisUnsafe() };
				delete next.reason;
				yield* supersedeVersion(next);
				yield* executions.put(next);
				return next;
			});
			const approve = Effect.fnUntraced(function*(
				execution: Execution,
				actor: string,
				mode: 'immediate' | 'queue' | 'force',
			) {
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
				const incomplete = yield* metadataBlocks(execution);
				if (incomplete.length) return yield* precondition(incomplete.join('; '));
				const { pending, failed, skipped } = yield* commitChecks(execution);
				const problems = [...failed, ...pending];
				if (mode !== 'force' && problems.length) {
					const reason = problems.join('; ');
					if (mode !== 'queue' || failed.length) return yield* precondition(reason);
					const prior = execution.approvalRequest;
					if (prior?.sourceSha === execution.sourceSha && execution.reason === reason) return execution;
					const request = prior?.sourceSha === execution.sourceSha ? prior : { actor, sourceSha: execution.sourceSha };
					const next = { ...execution, approvalRequest: request, reason };
					yield* executions.put(next);
					return next;
				}
				const target = `${execution.id}:${execution.sourceSha}`;
				const override = problems.length ? ` overriding: ${problems.join('; ')}` : '';
				const skips = skipped.length ? ` skipping: ${skipped.join('; ')}` : '';
				return yield* admit(execution, actor, target + override + skips);
			});
			const ungranted = Effect.fnUntraced(function*(execution: Execution) {
				const stream = execution.configuration.streams[execution.stream];
				if (!stream?.credentials.length) return undefined;
				const record = yield* store.repositories.get(execution.repositoryId);
				const defaultBranch = record?.defaultBranch ?? execution.workflow?.ref ?? '';
				const bindings = [
					[releaseOperation, stream.release.workflow] as const,
					['prepare', stream.prepare.workflow] as const,
					...Object.entries(stream.workflows).filter(([, binding]) => binding.mode !== 'observe'),
				].flatMap(([operation, binding]) => {
					if (!binding) return [];
					const ref = binding.ref ?? defaultBranch;
					return [{ operation, file: binding.file, ref: ref.startsWith('refs/') ? ref : `refs/heads/${ref}` }];
				});
				const missing: string[] = [];
				for (const alias of stream.credentials) {
					const grants = yield* automation.grants.list({ alias, repositoryId: execution.repositoryId });
					if (!coversBinding(grants, bindings, execution.repository)) missing.push(alias);
				}
				const workflow = stream.release.workflow?.file ?? execution.workflow?.file;
				return missing.length
					? `no runtime grant for ${workflow}: ${missing.join(', ')}`
					: undefined;
			});
			const upstream = Effect.fnUntraced(function*(execution: Execution, all: Execution[]) {
				const record = yield* store.repositories.get(execution.repositoryId);
				if (!record) return undefined;
				const file = execution.workflow?.file;
				if (record.inventory.workflows.some(workflow => workflow.file === file && workflow.ledger)) return undefined;
				const packagesOf = (candidate: Execution) => {
					const references = candidate.configuration.streams[candidate.stream]?.packages;
					return publishablePackages(record.inventory.packages, references);
				};
				const needed = new Set(
					packagesOf(execution).flatMap(pkg => pkg.dependencies.map(name => `${pkg.manager}:${name}`)),
				);
				for (const other of all) {
					if (
						other.id === execution.id || other.operation !== releaseOperation || other.stream === execution.stream
						|| other.repositoryId !== execution.repositoryId
						|| settledStates.includes(other.state)
					) continue;
					const provided = packagesOf(other).filter(pkg =>
						needed.has(`${pkg.manager}:${pkg.name}`)
						&& (other.sourceSha === execution.sourceSha || pkg.version === other.version)
					);
					if (provided.length) {
						return `waiting for ${other.stream}: ${provided.map(packageId).join(', ')}`;
					}
				}
				return undefined;
			});
			const approveFromPush = Effect.fnUntraced(function*(execution: Execution, all: Execution[]) {
				const newer = all.find(other =>
					other.id !== execution.id && other.operation === releaseOperation && other.stream === execution.stream
					&& other.version === execution.version && other.createdAt > execution.createdAt
					&& !settledStates.includes(other.state)
				);
				if (newer) {
					yield* executions.put({ ...execution, state: 'cancelled', reason: `Superseded by ${newer.id}` });
					return true;
				}
				const conflict = yield* refs.tagProblem(execution, true);
				if (conflict) {
					yield* executions.put({ ...execution, state: 'cancelled', reason: conflict });
					return true;
				}
				const waiting = (yield* ungranted(execution)) ?? (yield* upstream(execution, all));
				if (waiting) {
					if (execution.reason !== waiting) yield* executions.put({ ...execution, reason: waiting });
					return false;
				}
				const forced = execution.started?.force === true;
				const { pending, failed, skipped } = forced
					? { pending: [], failed: [], skipped: [] }
					: yield* commitChecks(execution);
				if (execution.approvedBy === 'start' && failed.length) {
					yield* executions.put({ ...execution, state: 'failed', reason: failed.join('; ') });
					return true;
				}
				const problems = [...failed, ...pending];
				if (problems.length) {
					const reason = problems.join('; ');
					if (execution.reason !== reason) yield* executions.put({ ...execution, reason });
					return false;
				}
				yield* admit(
					execution,
					'beepboop',
					`${execution.id}:${execution.sourceSha}:${execution.approvedBy ?? 'push'}${forced ? ':forced' : ''}${
						skipped.length ? ` skipping: ${skipped.join('; ')}` : ''
					}`,
				);
				return true;
			});

			return ApprovalGate.of({
				problems: execution =>
					commitChecks(execution).pipe(Effect.map(({ pending, failed }) => [...failed, ...pending])),
				metadataBlocks,
				forced: Effect.fnUntraced(function*(id: string, pkg: LedgerPackage) {
					const execution = yield* executions.get(id);
					const metadata = execution.started?.force === true
						|| (yield* gateSkips(execution)).some(skip => skip.gate.kind === 'metadata');
					return metadata ? { ...pkg, force: true } : pkg;
				}),
				approve,
				review: Effect.fnUntraced(function*(execution: Execution, all: Execution[]) {
					const request = execution.approvalRequest;
					if (request) {
						const attempt = request.sourceSha === execution.sourceSha
							? approve(execution, request.actor, 'queue')
							: Effect.fail(precondition('The approved source commit changed'));
						const result = yield* Effect.result(attempt);
						if (Result.isFailure(result)) {
							const { failure } = result;
							if (failure.problem.code !== 'precondition') return yield* failure;
							const next = { ...execution, reason: failure.message };
							delete next.approvalRequest;
							yield* executions.put(next);
							return 'continue' as const;
						}
						if (result.success.state === 'awaiting-approval') return 'continue' as const;
						yield* planner.requestReconcile(yield* Clock.currentTimeMillis);
						return 'stop' as const;
					}
					const incomplete = execution.started?.force ? [] : yield* metadataBlocks(execution);
					const blocked = incomplete.length ? `${metadataReason}${incomplete.join('; ')}` : undefined;
					let current = execution;
					if (blocked !== execution.reason && (blocked || execution.reason?.startsWith(metadataReason))) {
						current = { ...execution, ...(blocked ? { reason: blocked } : {}) };
						if (!blocked) delete current.reason;
						yield* executions.put(current);
					}
					if (blocked && current.approvedBy === 'start') {
						yield* executions.put({ ...current, state: 'failed', reason: blocked });
						return 'continue' as const;
					}
					if (blocked) return 'continue' as const;
					if (
						current.configuration.streams[current.stream]?.release.approval !== 'push'
						&& current.approvedBy === undefined
					) return 'continue' as const;
					const approved = current;
					return yield* approveFromPush(approved, all).pipe(
						Effect.flatMap(done =>
							done
								? Clock.currentTimeMillis.pipe(
									Effect.flatMap(now => planner.requestReconcile(now)),
									Effect.as('stop' as const),
								)
								: Effect.succeed('continue' as const)
						),
						recover(error =>
							Effect.gen(function*() {
								const reason = `commit check error: ${decodeError(error)}`;
								if (approved.reason !== reason) yield* executions.put({ ...approved, reason });
								return 'continue' as const;
							})
						),
					);
				}),
				gates: Effect.fnUntraced(function*(repositoryId: number, stream: string) {
					const record = yield* store.repositories.get(repositoryId);
					const configuration = record?.configuration;
					if (!record || !configuration || !Object.hasOwn(configuration.streams, stream)) {
						return yield* notFound('stream', `Unknown stream ${stream}`, stream);
					}
					const release = gatedRelease(yield* executions.all, stream);
					const subject: GateSubject = release
						?? { repository: record.name, repositoryId, sourceSha: record.sha, configuration, stream };
					const [{ outcomes }, skips, metadata] = yield* Effect.all([
						commitGates(subject),
						store.gateSkips.list(repositoryId, stream),
						metadataProblemsOf(subject),
					], { concurrency: 'unbounded' });
					const merged = mergedOutcomes([...outcomes, {
						gate: { kind: 'metadata' },
						state: metadata.length ? 'failed' : 'passed',
						fact: metadata.length ? 'incomplete' : 'complete',
						...(metadata.length ? { detail: metadata.join('; ') } : {}),
					}]);
					const skipOf = (gate: ReleaseGate) => skips.find(skip => sameGate(skip.gate, gate));
					const gates: GateView[] = merged.map(outcome => {
						const skip = skipOf(outcome.gate);
						const { run: _run, ...shown } = outcome;
						return { ...shown, ...(skip ? { skipped: { actor: skip.actor, at: skip.at } } : {}) };
					});
					for (const skip of skips) {
						if (merged.some(outcome => sameGate(outcome.gate, skip.gate))) continue;
						gates.push({
							gate: skip.gate,
							state: 'absent',
							fact: 'not on this commit',
							skipped: { actor: skip.actor, at: skip.at },
						});
					}
					return {
						stream,
						commit: subject.sourceSha,
						...(release?.version ? { version: release.version } : {}),
						gates,
					};
				}),
				resolveChecks: Effect.fnUntraced(function*(id: string, choice: CheckChoice, actor: string) {
					const clock = yield* Clock.Clock;
					const execution = yield* executions.get(id);
					if (execution.operation !== releaseOperation || !['failed', 'awaiting-approval'].includes(execution.state)) {
						return yield* precondition('Only a release that waits on its checks or stopped on them takes this choice');
					}
					if (execution.state === 'failed' && (execution.attempts > 0 || execution.approvedAt !== undefined)) {
						return yield* precondition('This release already ran its workflow; retry it instead');
					}
					const [{ outcomes }, skips, metadata] = yield* Effect.all([
						commitGates(execution),
						gateSkips(execution),
						metadataProblemsOf(execution),
					], { concurrency: 'unbounded' });
					const stopping = mergedOutcomes([
						...outcomes,
						...(metadata.length
							? [{ gate: { kind: 'metadata' as const }, state: 'failed' as const, fact: 'incomplete' }]
							: []),
					]).filter(outcome => outcome.state !== 'passed' && !skips.some(skip => sameGate(skip.gate, outcome.gate)));
					const next: Execution = execution.state === 'failed'
						? { ...execution, state: 'awaiting-approval', publications: reopened(execution.publications) }
						: { ...execution };
					delete next.reason;
					if (!stopping.length) {
						if (execution.state !== 'failed') return yield* precondition('No check stops this release');
						yield* executions.put(next);
						yield* wakeUp(sets, planner);
						return next;
					}
					const at = clock.currentTimeMillisUnsafe();
					if (choice === 'rerun') {
						const runs = new Map(
							outcomes.flatMap(outcome =>
								outcome.state === 'failed' && outcome.run?.done === true
									&& stopping.some(entry => sameGate(entry.gate, outcome.gate))
									? [[outcome.run.id, (outcome.run.attempt ?? 1) + 1] as const]
									: []
							),
						);
						if (!runs.size) return yield* precondition('No finished check run failed, so none can rerun');
						const token = yield* gateway.token(execution.repository, execution.repositoryId, {
							contents: 'read',
							actions: 'write',
						});
						for (const [run, attempt] of runs) {
							yield* gateway.call(
								`/repos/${execution.repository}/actions/runs/${run}/rerun-failed-jobs`,
								token,
								'POST',
							);
							next.reruns = [...(next.reruns ?? []).filter(rerun => rerun.id !== run), { id: run, attempt }];
							yield* executions.put(next);
							yield* store.audit(actor, 'release.checks.rerun', `${id}: ${run}`);
						}
					} else if (choice === 'skip') {
						next.skippedGates = [
							...(execution.skippedGates ?? []),
							...stopping.map(outcome => ({ gate: outcome.gate, actor, at })),
						];
						yield* store.audit(
							actor,
							'release.checks.skip',
							`${id}: ${stopping.map(outcome => gateLabel(outcome.gate)).join(', ')}`,
						);
					} else {
						const failing = stopping.filter(outcome => outcome.state === 'failed');
						if (!failing.length) return yield* precondition('No failed check to switch off');
						for (const outcome of failing) {
							yield* store.gateSkips.skip(execution.repositoryId, execution.stream, outcome.gate, actor);
							yield* store.audit(
								actor,
								'stream.gate.skip',
								`${execution.repository}:${execution.stream}:${gateLabel(outcome.gate)}`,
							);
						}
					}
					yield* executions.put(next);
					yield* wakeUp(sets, planner);
					return next;
				}),
			});
		}),
	);
}
