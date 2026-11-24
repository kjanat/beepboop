import { Clock, Context, Effect, Layer } from 'effect';
import type { RunExpectation, RunIdentity } from '@/auth/actions-oidc.ts';
import { WorkflowRunGuard } from '@/auth/actions-oidc.ts';
import { PreparationWriter } from '@/automation/preparation-writer.ts';
import { ReleaseCommits } from '@/automation/release-commits.ts';
import { Automation } from '@/automation/service.ts';
import { repositorySnapshot } from '@/automation/snapshot.ts';
import type { Edit } from '@/domain/inventory.ts';
import { parseIdentity } from '@/domain/package-identity.ts';
import { matchesRef } from '@/domain/ref-policy.ts';
import { workflowRunSchema } from '@/github/resources.ts';
import { classifyRun } from '@/github/run-state.ts';
import { toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { sha256DigestPattern } from '@/kernel/schema/ids.ts';
import type { Publication } from '@/publication/publication.ts';
import {
	dependenciesReady,
	expectedRunTitle,
	mergePublications,
	settleRun,
	validatePublicationIdentity,
} from '@/release/domain/execution/execution.ts';
import { mergeArtifacts, resolveInputs } from '@/release/domain/execution/outputs.ts';
import type { Artifact, Execution, PreparationResult } from '@/release/domain/execution/types.ts';
import { preparationBody } from '@/release/domain/managed.ts';
import { preparationRequest } from '@/release/domain/preparation-request.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

type CallbackExpectation = RunExpectation | { readonly _tag: 'NewRun' };

export class RunCallbacks extends Context.Service<RunCallbacks, {
	readonly register: (id: string, identity: RunIdentity) => Effect.Effect<Execution, DomainError>;
	readonly prepared: (
		id: string,
		identity: RunIdentity,
		edits: Edit[],
	) => Effect.Effect<PreparationResult, DomainError>;
	readonly report: (
		id: string,
		identity: RunIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	) => Effect.Effect<Execution, DomainError>;
}>()('beepboop/automation/RunCallbacks') {
	static readonly layer = Layer.effect(
		RunCallbacks,
		Effect.gen(function*() {
			const { gateway } = yield* Automation;
			const executions = yield* Executions;
			const writer = yield* PreparationWriter;
			const commits = yield* ReleaseCommits;
			const bindRun = Effect.fnUntraced(function*(id: string, identity: RunIdentity, binding: CallbackExpectation) {
				const execution = yield* executions.get(id);
				const workflow = execution.workflow;
				if (!workflow || execution.managed) return yield* precondition('Operation is not a workflow');
				if (binding._tag !== 'NewRun') yield* WorkflowRunGuard.require(execution, identity, binding);
				return { execution, workflow };
			});
			return RunCallbacks.of({
				register: Effect.fnUntraced(function*(id: string, identity: RunIdentity) {
					const { execution, workflow } = yield* bindRun(id, identity, { _tag: 'NewRun' });
					const dependencies = yield* Effect.forEach(execution.dependencies, id => executions.get(id), {
						concurrency: 'unbounded',
					});
					if (!dependenciesReady(execution, dependencies)) {
						return yield* precondition('Execution dependencies have not succeeded');
					}
					if (execution.attempts === 0 && execution.eventId !== `observed:${identity.runId}`) {
						return yield* precondition('Execution has not been dispatched');
					}
					if (
						execution.repositoryId !== identity.repositoryId
						|| execution.repository !== identity.repository
						|| !['pending', 'ready', 'dispatching', 'uncertain', 'running'].includes(execution.state)
					) {
						return yield* precondition('Execution cannot register this run');
					}
					const expected = `${identity.repository}/.github/workflows/${workflow.file}@`;
					if (!identity.workflowRef.startsWith(expected)) return yield* precondition('Workflow binding mismatch');
					if (execution.runId && execution.runId !== identity.runId) {
						return yield* precondition('Execution is already bound to a run');
					}
					if (execution.supersededRuns?.includes(identity.runId)) {
						return yield* precondition('A newer run of this execution replaced this run');
					}
					if (execution.runAttempt && identity.attempt < execution.runAttempt) {
						return yield* precondition('Stale run attempt');
					}
					const token = yield* gateway.token(execution.repository, execution.repositoryId);
					const run = yield* gateway.read(
						workflowRunSchema,
						`/repos/${execution.repository}/actions/runs/${identity.runId}`,
						token,
					);
					if (
						run.repository.id !== execution.repositoryId
						|| run.head_sha !== identity.sha
						|| run.path !== `.github/workflows/${workflow.file}`
						|| run.run_attempt !== identity.attempt
					) {
						return yield* precondition('Run identity mismatch');
					}
					if (!(yield* commits.contains(execution, run.head_sha, token))) {
						return yield* precondition(
							`The run is at ${run.head_sha.slice(0, 12)} but this execution releases ${
								execution.sourceSha.slice(0, 12)
							}`,
						);
					}
					if (!matchesRef(workflow.ref, identity.ref)) return yield* precondition('Workflow ref mismatch');
					if (execution.attempts > 0 && !execution.runId && run.display_title !== expectedRunTitle(execution)) {
						return yield* precondition('Dispatch correlation mismatch');
					}
					const resolvedInputs = yield* resolveInputs(execution, dependencies);
					const next: Execution = {
						...settleRun(execution, classifyRun(run)),
						resolvedInputs,
						state: 'running',
						runId: identity.runId,
						runAttempt: identity.attempt,
						workflowSha: identity.workflowSha,
						helperShas: [
							...new Set([...(execution.helperShas ?? []), identity.helperSha ?? identity.workflowSha]),
						],
					};
					yield* executions.put(next);
					return next;
				}),
				prepared: Effect.fnUntraced(function*(id: string, identity: RunIdentity, edits: Edit[]) {
					const { execution } = yield* bindRun(id, identity, {
						_tag: 'SameRun',
						mismatch: 'Preparation run identity mismatch',
					});
					if (execution.operation !== 'prepare' || !execution.plan) {
						return yield* precondition('Preparation run identity mismatch');
					}
					const ordered = [...edits].sort((a, b) => a.path.localeCompare(b.path));
					if (execution.prepared && JSON.stringify(execution.prepared.edits) !== JSON.stringify(ordered)) {
						return yield* precondition('Submitted preparation changed; create a new preparation');
					}
					if (execution.prepared?.result) return execution.prepared.result;
					const prepared = execution.prepared ?? { edits: ordered };
					execution.prepared = prepared;
					yield* executions.put(execution);
					const source = yield* repositorySnapshot(
						gateway,
						execution.repository,
						execution.repositoryId,
						execution.sourceSha,
						ordered.map(edit => edit.path),
					);
					const result = yield* writer.submit(preparationRequest(execution, prepared, source, {
						branch: `release/${execution.stream}/${execution.id}`,
						title: `chore(release): prepare ${execution.version ?? 'release set'}`,
						body: `Source: ${execution.sourceSha}\nPreparation execution: ${execution.id}\n\n${
							preparationBody(execution)
						}`,
						edits: ordered,
					}));
					prepared.result = result;
					yield* executions.put(execution);
					return result;
				}),
				report: Effect.fnUntraced(function*(
					id: string,
					identity: RunIdentity,
					publications: Publication[],
					artifacts: Artifact[],
				) {
					const { execution, workflow } = yield* bindRun(id, identity, {
						_tag: 'SameRun',
						mismatch: 'Report identity mismatch',
					});
					const now = yield* Clock.currentTimeMillis;
					for (const artifact of artifacts) {
						if (artifact.runId !== identity.runId) return yield* precondition('Artifact producer mismatch');
						if (!sha256DigestPattern.test(artifact.digest) || !(Date.parse(artifact.expiresAt) > now)) {
							return yield* precondition('Artifact has no usable digest or has expired');
						}
					}
					const accepted: Publication[] = [];
					let release = execution.release;
					for (const reported of publications) {
						const identity = yield* Effect.fromResult(parseIdentity(reported, execution.repository)).pipe(
							Effect.mapError(toDomainError),
						);
						const publication = { ...reported, identity };
						if (publication.id.startsWith('refs:')) {
							return yield* precondition('Ref results are recorded by the ref completion endpoint');
						}
						yield* validatePublicationIdentity(execution, publication);
						if (publication.manager === 'github-release' && publication.name !== execution.repository) {
							return yield* precondition('Release repository mismatch');
						}
						if (publication.manager === 'github-release' && publication.outcome === 'succeeded') {
							if (release?.tag && release.tag !== publication.version) {
								return yield* precondition('Release identity changed');
							}
							release = {
								id: `github:${execution.repositoryId}:tag:${publication.version}`,
								repository: { id: execution.repositoryId, name: execution.repository },
								stream: execution.stream,
								commit: execution.sourceSha,
								version: execution.version ?? publication.version.replace(/^v/, ''),
								artifacts: [],
								publications: [],
								...release,
								tag: publication.version,
							};
						}
						accepted.push(publication);
					}
					const merged = yield* mergeArtifacts(execution.artifacts, artifacts, workflow.outputs);
					const next = {
						...execution,
						release,
						publications: yield* mergePublications(execution.publications, accepted),
						artifacts: merged,
					};
					yield* executions.put(next);
					return next;
				}),
			});
		}),
	);
}
