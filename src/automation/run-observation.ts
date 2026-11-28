import { Context, Effect, Layer, Schema } from 'effect';
import { ReleaseSets } from '@/automation/release-sets.ts';
import { runJobs } from '@/automation/run-jobs.ts';
import { Automation } from '@/automation/service.ts';
import { repositorySnapshot } from '@/automation/snapshot.ts';
import { wakeUp } from '@/automation/wake-up.ts';
import { discover } from '@/discovery/discover.ts';
import type { WorkflowJobs } from '@/discovery/workflow-analysis/job-gate.ts';
import { gateState, resolvable, workflowJobs } from '@/discovery/workflow-analysis/job-gate.ts';
import {
	matchesPackage,
	packageId,
	publicationIdentity,
	publishablePackages,
	selectorKey,
} from '@/domain/package-identity.ts';
import { matchesRef } from '@/domain/ref-policy.ts';
import type { ReadyRepository } from '@/domain/repository';
import { readiness } from '@/domain/repository';
import { tagPrefix } from '@/domain/version-tags.ts';
import { workflowPath } from '@/domain/workflow-path.ts';
import type { WorkflowRun } from '@/github/resources.ts';
import { gitRefSchema, releaseSchema, workflowRunSchema } from '@/github/resources.ts';
import type { RunJob } from '@/github/run-state.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { Publication } from '@/publication/publication.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import { canVerifyPublication, verifyPublication } from '@/publication/registries/verify.ts';
import type { Observation } from '@/release/adapters/do/keys.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { createExecution, deriveExecution } from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { executionId } from '@/release/domain/identity-keys.ts';
import { refShape, taggedVersion } from '@/release/domain/observation/classify.ts';
import { observedVersion, placeholderVersion } from '@/release/domain/planning/managers.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

const observedEvents = ['push', 'release', 'workflow_dispatch', 'schedule', 'workflow_run', 'repository_dispatch'];

export class RunObservation extends Context.Service<RunObservation, {
	readonly observeRun: (repositoryId: number, runId: number) => Effect.Effect<void, DomainError>;
	readonly trackRun: (repositoryId: number, runId: number) => Effect.Effect<void, DomainError>;
	readonly observe: (event: Observation) => Effect.Effect<void, DomainError>;
	readonly track: (event: Observation) => Effect.Effect<boolean, DomainError>;
}>()('beepboop/automation/RunObservation') {
	static readonly layer = Layer.effect(
		RunObservation,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const { gateway, store } = automation;
			const storage = yield* DurableStorage;
			const executions = yield* Executions;
			const sets = yield* ReleaseSets;
			const planner = yield* AlarmPlanner;

			const observedRun = Effect.fnUntraced(function*(event: Observation) {
				const stored = yield* store.repositories.get(event.repositoryId);
				const state = stored && readiness(stored);
				if (state?.kind !== 'ready') return undefined;
				const repository = state.repository;
				const token = yield* gateway.token(repository.name, repository.id);
				const run = yield* gateway.read(
					workflowRunSchema,
					`/repos/${repository.name}/actions/runs/${event.runId}`,
					token,
				);
				if (run.repository.id !== repository.id || !observedEvents.includes(String(run.event))) return undefined;
				return { repository, run, token };
			});
			const openGates = Effect.fnUntraced(function*(
				repository: ReadyRepository,
				run: WorkflowRun,
				token: string,
				parents: Effect.Effect<Execution[], DomainError>,
			) {
				let waiting = false;
				let workflow: WorkflowJobs | null | undefined;
				let jobs: RunJob[] | undefined;
				const ready: { stream: string; operation: string; needed: string }[] = [];
				for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
					for (const [operation, binding] of Object.entries(stream.workflows)) {
						for (const [needed, required] of Object.entries(binding.needsJobs ?? {})) {
							const neededBinding = stream.workflows[needed];
							if (!neededBinding || run.path !== workflowPath(neededBinding.file)) continue;
							const id = yield* executionId(repository.id, streamName, operation, `observed:${run.id}`);
							if (yield* executions.stored(id)) continue;
							if (workflow === undefined) {
								const source = yield* gateway.file(repository.name, run.path, run.head_sha, token);
								workflow = (source === null ? undefined : workflowJobs(source)) ?? null;
							}
							if (!workflow || !resolvable(workflow, required)) continue;
							jobs ??= yield* runJobs(gateway, repository.name, run, token);
							const gate = gateState(workflow, required, jobs);
							if (gate === 'waiting') waiting = true;
							if (gate === 'ready') ready.push({ stream: streamName, operation, needed });
						}
					}
				}
				if (!ready.length) return waiting;
				const observed = yield* parents;
				for (const gate of ready) {
					const parent = observed.find(execution =>
						execution.stream === gate.stream && execution.operation === gate.needed && execution.state === 'running'
					);
					if (!parent) continue;
					const next = yield* deriveExecution(parent, repository, {
						stream: gate.stream,
						operation: gate.operation,
						eventId: parent.eventId,
						sourceSha: parent.sourceSha,
						...(parent.version ? { version: parent.version } : {}),
					});
					yield* executions.put({ ...next, dependencies: next.dependencies.filter(id => id !== parent.id) });
				}
				return waiting;
			});
			const observeRunOf = Effect.fnUntraced(function*(
				repository: ReadyRepository,
				run: WorkflowRun,
				token: string,
				record: boolean,
			) {
				const observedExecutions: Execution[] = [];
				const settle = Effect.fnUntraced(function*(execution: Execution) {
					if (record) yield* executions.put(execution);
					observedExecutions.push(execution);
				});
				if (typeof run.head_branch !== 'string') return observedExecutions;
				const branch = run.head_branch;
				const patterns = Object.values(repository.configuration.streams).flatMap(stream =>
					Object.values(stream.workflows).flatMap(binding =>
						run.path === workflowPath(binding.file) ? [binding.ref ?? repository.defaultBranch] : []
					)
				);
				const tagTarget = Effect.fnUntraced(function*(name: string) {
					const tag = yield* gateway.read(
						Schema.NullOr(gitRefSchema),
						`/repos/${repository.name}/git/ref/tags/${encodeURIComponent(name)}`,
						token,
					);
					if (!tag) return undefined;
					return yield* gateway.peelTag(repository.name, tag.object, token);
				});
				const { tagLike, branchLike } = refShape(patterns, branch);
				const tagged = run.event === 'release'
					|| (tagLike && (!branchLike || (yield* tagTarget(branch))?.sha === run.head_sha));
				const ref = tagged ? `refs/tags/${branch}` : `refs/heads/${branch}`;
				for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
					for (const [operation, binding] of Object.entries(stream.workflows)) {
						const pattern = binding.ref ?? repository.defaultBranch;
						if (
							binding.mode !== 'observe'
							|| run.path !== workflowPath(binding.file)
							|| !matchesRef(pattern, ref)
						) {
							continue;
						}
						const version = tagged ? taggedVersion(stream, pattern, branch) : undefined;
						const manifestVersions = !tagged
							&& (run.event === 'workflow_dispatch' || (binding.publications?.length ?? 0) > 0);
						const eventId = `observed:${run.id}`;
						const id = yield* executionId(repository.id, streamName, operation, eventId);
						if (yield* storage.has(Keys.execution, id)) {
							const previous = yield* executions.get(id);
							if (previous.state === 'succeeded' || (previous.runAttempt ?? 0) >= run.run_attempt) continue;
						}
						const snapshot = yield* repositorySnapshot(gateway, repository.name, repository.id, run.head_sha);
						const execution = yield* createExecution(repository, {
							stream: streamName,
							operation,
							eventId,
							sourceSha: snapshot.sha,
							version,
							observed: true,
						});
						execution.runId = run.id;
						execution.runAttempt = run.run_attempt;
						execution.refNamespace = tagged ? 'tags' : 'heads';
						execution.state = 'running';
						execution.dependencies = (yield* executions.all).filter(other =>
							other.stream === streamName && other.operation === 'promote' && other.state === 'succeeded'
							&& version !== undefined && other.version === version && other.sourceSha === snapshot.sha
						).map(other => other.id);
						if (version) {
							const target = yield* tagTarget(branch);
							if (!target) {
								yield* settle({ ...execution, state: 'failed', reason: `Release tag ${branch} was not found` });
								continue;
							}
							if (target.type !== 'commit' || target.sha !== snapshot.sha) {
								yield* settle({
									...execution,
									state: 'failed',
									reason: `Release tag ${branch} does not point at the source commit`,
								});
								continue;
							}
						}
						const inventory = discover(snapshot, repository.configuration.managers);
						if (
							inventory.diagnostics.some(d =>
								d.severity === 'blocking'
								&& (d.code === 'invalid-manifest' || d.code === 'cycle' || d.code === 'duplicate-identity')
							)
						) {
							return yield* precondition('Producer inventory is incomplete');
						}
						const observed = publishablePackages(inventory.packages, stream.packages).filter(
							(p) =>
								(Boolean(version) || (manifestVersions && tagPrefix(p.versionSource) === undefined))
								&& (binding.publications === undefined
									|| binding.publications.some(reference => matchesPackage(reference, p))),
						);
						const mismatched = version !== undefined && stream.versioning === 'workspace'
							? observed.filter(p =>
								tagPrefix(p.versionSource) === undefined && p.version !== undefined && !placeholderVersion(p.version)
								&& p.version !== version
							)
							: [];
						if (mismatched.length) {
							yield* settle({
								...execution,
								state: 'failed',
								reason: `Tag ${branch} names version ${version}, but ${
									mismatched.map(p => `${p.name} carries ${p.version}`).join(', ')
								}`,
							});
							continue;
						}
						if (!record) {
							yield* settle(execution);
							continue;
						}
						for (const pkg of observed) {
							if (!canVerifyPublication(pkg.manager)) continue;
							const released = version === undefined ? pkg.version : observedVersion(pkg, branch, version);
							if (released === undefined) continue;
							const publication: Publication = {
								id: packageId(pkg),
								identity: publicationIdentity(pkg, released),
								manager: pkg.manager,
								name: pkg.name,
								version: released,
								outcome: 'pending',
								required: !pkg.optional,
							};
							const context = gateway.verification(repository.name, repository.id);
							execution.publications.push(
								verifiedPublication(
									publication,
									yield* verifyPublication(publication, automation.dependencies.transport, context),
								),
							);
						}
						const releaseId = `github-release:${repository.name}`;
						if (tagged && binding.publications?.some(id => selectorKey(id) === selectorKey(releaseId))) {
							const release = yield* gateway.read(
								Schema.NullOr(releaseSchema),
								`/repos/${repository.name}/releases/tags/${encodeURIComponent(branch)}`,
								token,
							);
							execution.publications.push({
								id: releaseId,
								manager: 'github-release',
								name: repository.name,
								version: branch,
								outcome: release && release.draft === false && release.assets.length ? 'succeeded' : 'failed',
								required: true,
								...(typeof release?.html_url === 'string' ? { url: release.html_url } : {}),
							});
						}
						yield* settle(execution);
					}
				}
				return observedExecutions;
			});

			return RunObservation.of({
				observeRun: Effect.fnUntraced(function*(repositoryId: number, runId: number) {
					yield* storage.put(Keys.observe, String(runId), { repositoryId, runId });
					yield* wakeUp(sets, planner);
				}),
				trackRun: Effect.fnUntraced(function*(repositoryId: number, runId: number) {
					if (!(yield* storage.has(Keys.track, String(runId)))) {
						yield* storage.put(Keys.track, String(runId), { repositoryId, runId });
					}
					yield* wakeUp(sets, planner);
				}),
				observe: Effect.fnUntraced(function*(event: Observation) {
					const observed = yield* observedRun(event);
					if (!observed) return;
					const parents = yield* observeRunOf(observed.repository, observed.run, observed.token, true);
					yield* openGates(observed.repository, observed.run, observed.token, Effect.succeed(parents));
				}),
				track: Effect.fnUntraced(function*(event: Observation) {
					const observed = yield* observedRun(event);
					if (!observed || observed.run.status === 'completed') return true;
					const { repository, run, token } = observed;
					return !(yield* openGates(repository, run, token, observeRunOf(repository, run, token, false)));
				}),
			});
		}),
	);
}
