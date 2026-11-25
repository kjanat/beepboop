import { Clock, Effect } from 'effect';
import type { DispatchedExecution } from '@/auth/workflow-token.ts';
import { managerSpec } from '@/domain/catalog.ts';
import type { DiscoveredWorkflow, Package, RepositoryRecord } from '@/domain/inventory.ts';
import { matchesPackage, matchesPublication, packageId, parseIdentity } from '@/domain/package-identity.ts';
import type { ReadyRepository } from '@/domain/repository';
import type { GitHubRunResult } from '@/github/run-state.ts';
import { toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Publication } from '@/publication/publication.ts';
import { outputsComplete } from '@/release/domain/execution/outputs.ts';
import { githubFailureReason, githubRunLabel } from '@/release/domain/execution/run-labels.ts';
import type { Configuration, Execution, ReleaseReference, WorkflowBinding } from '@/release/domain/execution/types.ts';
import { executionId } from '@/release/domain/identity-keys.ts';
import { freezePackageTags, packageTagGroups } from '@/release/domain/package-tags.ts';
import { streamModuleTags } from '@/release/domain/refs.ts';

export interface ExecutionRequest {
	stream: string;
	operation: string;
	eventId: string;
	sourceSha: string;
	version?: string | undefined;
	observed?: boolean;
	upstreamRelease?: ReleaseReference | undefined;
	perPackage?: boolean;
}

interface ExecutionSource {
	repositoryId: number;
	repository: string;
	defaultBranch: string;
	configuration: Configuration;
	configurationSha: string;
	presetShas: Record<string, string>;
	workflows: readonly DiscoveredWorkflow[];
	packages: readonly Package[];
}

export function createExecution(
	repository: ReadyRepository,
	request: ExecutionRequest,
): Effect.Effect<Execution, DomainError> {
	return executionFrom({
		repositoryId: repository.id,
		repository: repository.name,
		defaultBranch: repository.defaultBranch,
		configuration: repository.configuration,
		configurationSha: repository.sha,
		presetShas: repository.presetShas,
		workflows: repository.inventory.workflows,
		packages: repository.inventory.packages,
	}, request);
}

export function deriveExecution(
	parent: Execution,
	revision: Pick<RepositoryRecord, 'defaultBranch' | 'inventory'>,
	request: ExecutionRequest,
): Effect.Effect<Execution, DomainError> {
	return executionFrom({
		repositoryId: parent.repositoryId,
		repository: parent.repository,
		defaultBranch: revision.defaultBranch,
		configuration: parent.configuration,
		configurationSha: parent.configurationSha,
		presetShas: parent.presetShas,
		workflows: revision.inventory.workflows,
		packages: revision.inventory.packages,
	}, request).pipe(
		Effect.map(execution =>
			parent.initiatedBy === undefined ? execution : { ...execution, initiatedBy: parent.initiatedBy }
		),
	);
}

function executionFrom(source: ExecutionSource, request: ExecutionRequest): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const clock = yield* Clock.Clock;

		const { stream: streamName, operation, eventId, version, upstreamRelease } = request;
		const observed = request.observed === true;
		const stream = source.configuration.streams[streamName];
		if (!stream) return yield* precondition('Unknown stream');
		const binding: WorkflowBinding | undefined = operation === 'prepare'
			? stream.prepare.workflow
			: operation === 'promote'
			? stream.promote.workflow
			: stream.workflows[operation];
		if (!binding) return yield* precondition('Operation has no workflow binding');
		if (binding.backfill && !eventId.startsWith('backfill:')) return yield* precondition('Start backfills in Beepboop');
		if (binding.each === 'package' && request.perPackage !== true) {
			return yield* precondition('Per-package operations run inside a release set');
		}
		const workflow = source.workflows.find((w) => w.file === binding.file);
		if (
			!observed
			&& (!workflow?.events.includes('workflow_dispatch')
				|| !workflow.dispatchInputs.includes('beepboop_execution_id')
				|| binding.mode === 'observe')
		) {
			return yield* precondition('Workflow needs workflow_dispatch and beepboop_execution_id');
		}
		const tagsModules = binding.refs?.phase === 'version';
		const absent = tagsModules
			? stream.companionModules?.find(reference => !source.packages.some(pkg => matchesPackage(reference, pkg)))
			: undefined;
		if (absent !== undefined) {
			return yield* precondition(
				`Companion module ${absent} of stream ${streamName} is missing from discovery; refresh discovery or remove it from companionModules`,
			);
		}
		const id = yield* executionId(source.repositoryId, streamName, operation, eventId);
		const dependencies = yield* Effect.forEach(
			binding.needs ?? [],
			need => executionId(source.repositoryId, streamName, need, eventId),
			{ concurrency: 'unbounded' },
		);
		const execution: Execution = {
			id,
			repositoryId: source.repositoryId,
			...(upstreamRelease ? { upstreamRelease: structuredClone(upstreamRelease) } : {}),
			repository: source.repository,
			stream: streamName,
			operation,
			eventId,
			configuration: structuredClone(source.configuration),
			configurationSha: source.configurationSha,
			presetShas: { ...source.presetShas },
			sourceSha: request.sourceSha,
			...(version ? { version } : {}),
			state: observed ? 'pending' : operation === 'promote' ? 'awaiting-approval' : 'ready',
			dependencies,
			workflow: { ...binding, ref: binding.ref ?? source.defaultBranch },
			...(tagsModules ? { moduleTags: streamModuleTags(source.packages, stream) } : {}),
			...(tagsModules && version && stream.packageTags?.length
				? {
					packageTags: freezePackageTags(
						packageTagGroups(stream.packageTags, binding.refs?.prefix ?? '', source.packages),
						version,
					),
				}
				: {}),
			...(workflow?.dispatchInputs.includes('beepboop_title') ? { titled: true } : {}),
			attempts: 0,
			publications: [],
			artifacts: [],
			createdAt: clock.currentTimeMillisUnsafe(),
			updatedAt: clock.currentTimeMillisUnsafe(),
		};
		return execution;
	});
}
export function runTitle(execution: Execution): string {
	const label = execution.operation === 'prepare'
		? 'Prepare'
		: execution.operation === 'promote'
		? 'Release'
		: execution.operation;
	return [label, execution.package?.id, execution.version, `(${execution.id.slice(0, 8)})`]
		.filter(part => part !== undefined)
		.join(' ');
}
export function expectedRunTitle(execution: Execution): string {
	return execution.titled ? runTitle(execution) : `Release operation ${execution.id}`;
}
export function dispatchedExecution(execution: Execution): DispatchedExecution {
	return {
		repositoryId: execution.repositoryId,
		state: execution.state,
		...(execution.runId === undefined ? {} : { runId: execution.runId }),
		...(execution.workflow ? { workflow: { file: execution.workflow.file, ref: execution.workflow.ref } } : {}),
		runTitle: expectedRunTitle(execution),
	};
}
function requiredIds(execution: Execution): readonly string[] {
	return execution.workflow?.publications
		?? (execution.operation === 'publish'
			? (execution.configuration.streams[execution.stream]?.required ?? [])
			: []);
}
export function unreported(execution: Execution): string[] {
	return requiredIds(execution).filter(id => !execution.publications.some(p => matchesPublication(id, p)));
}
function requiredPublications(execution: Execution): Publication[] {
	const required = requiredIds(execution);
	return execution.publications.filter((p) => p.required || required.some(id => matchesPublication(id, p)));
}
export function completion(execution: Execution, runSucceeded: boolean): Execution['state'] {
	if (!runSucceeded) {
		return requiredPublications(execution).length && completion(execution, true) === 'succeeded'
			? 'succeeded'
			: 'failed';
	}
	if (execution.managed) return execution.managed.result ? 'succeeded' : 'blocked';
	if (execution.operation === 'prepare' && execution.plan && !execution.prepared?.result) return 'blocked';
	if (!outputsComplete(execution)) return 'blocked';
	if (
		execution.workflow?.refs
		&& !execution.publications.some(p => p.id === `refs:${execution.operation}` && p.outcome === 'succeeded')
	) return 'blocked';
	if (unreported(execution).length) return 'blocked';
	const publications = requiredPublications(execution);
	if (publications.some((p) => p.outcome === 'failed')) return 'failed';
	if (publications.some((p) => p.outcome === 'uncertain')) return 'uncertain';
	if (publications.some((p) => p.outcome === 'cancelled')) return 'cancelled';
	const open = publications.filter((p) => p.outcome !== 'succeeded');
	if (!open.length) return 'succeeded';
	return open.every(recheckable) ? 'verifying' : 'blocked';
}
export const runFailedNote = 'The workflow run failed after every required publication succeeded.';
export function settle(execution: Execution, runSucceeded: boolean): Execution {
	const state = completion(execution, runSucceeded);
	return !runSucceeded && state === 'succeeded'
		? { ...execution, state, reason: runFailedNote }
		: { ...execution, state };
}
/** Settle the publication lifecycle without discarding the provider's outcome. */
export function settleRun(execution: Execution, result: GitHubRunResult): Execution {
	const prior = execution.github && githubRunLabel(execution.github);
	const next: Execution = { ...execution, github: result.observation };
	if (prior && next.reason?.startsWith(prior)) delete next.reason;
	if (!result.observation.completed) {
		next.state = result.observation.kind === 'unknown' ? 'uncertain' : 'running';
		if (result.observation.kind !== 'running') next.reason = githubRunLabel(result.observation);
		return next;
	}
	const succeeded = result.observation.kind === 'succeeded';
	const settled = settle(next, succeeded);
	const missing = unreported(settled);
	if (settled.state === 'blocked' && succeeded && missing.length) {
		settled.reason = `The workflow run reported no outcome for ${missing.join(', ')}.`;
	} else if (settled.state === 'succeeded') {
		if (succeeded) delete settled.reason;
		else if (result.observation.kind !== 'failed') {
			settled.reason = `${githubRunLabel(result.observation)} after every required publication succeeded.`;
		}
	} else if (!succeeded) {
		if (result.observation.kind === 'action-required') settled.state = 'blocked';
		else if (result.observation.kind === 'unknown') settled.state = 'uncertain';
		else if (
			result.observation.kind === 'cancelled'
			&& !requiredPublications(next).some((p) => p.outcome === 'failed')
		) settled.state = 'cancelled';
		settled.reason = githubFailureReason(result);
	}
	return settled;
}
export function reopened(publications: Publication[]): Publication[] {
	return publications.map(publication =>
		publication.outcome === 'succeeded' ? publication : { ...publication, outcome: 'pending' as const }
	);
}
export function recoverable(execution: Execution): boolean {
	return execution.state === 'failed' || (execution.state === 'cancelled' && execution.cancelledBy === undefined);
}
export function publishedAfterFailure(execution: Execution): Execution | undefined {
	if (!recoverable(execution) || execution.runId === undefined) return undefined;
	const settled = execution.github?.completed
		? settleRun(execution, { observation: execution.github, jobs: [], retry: undefined })
		: settle(execution, false);
	return settled.state === 'succeeded' ? settled : undefined;
}
export function rechecked(execution: Execution): Execution {
	const published = publishedAfterFailure(execution);
	if (published) return published;
	return execution.state === 'cancelled' && recoverable(execution)
			&& requiredPublications(execution).some((p) => p.outcome === 'failed')
		? { ...execution, state: 'failed' }
		: execution;
}
export function recheckable(publication: Publication): boolean {
	return managerSpec(publication.manager).verifiable
		&& ['pending', 'uncertain'].includes(publication.outcome);
}
export function verifiableCancellation(publication: Publication): boolean {
	return publication.outcome === 'cancelled' && managerSpec(publication.manager).verifiable;
}
export function recheckedPublication(prior: Publication, checked: Publication): Publication {
	return prior.outcome === 'cancelled' && !['succeeded', 'failed'].includes(checked.outcome) ? prior : checked;
}
export function mergePublications(
	prior: Publication[],
	incoming: Publication[],
): Effect.Effect<Publication[], DomainError> {
	return Effect.gen(function*() {
		const key = (p: Publication) => p.id.startsWith('pkg:') || p.id === `${p.manager}:${p.name}` ? packageId(p) : p.id;
		const result = new Map(prior.map((p) => [key(p), p]));
		for (const publication of incoming) {
			const old = result.get(key(publication));
			if (
				old
				&& (old.manager !== publication.manager
					|| old.name !== publication.name
					|| old.version !== publication.version
					|| (old.digest && publication.digest && old.digest !== publication.digest))
			) {
				return yield* precondition('Publication identity changed');
			}
			if (old?.outcome === 'succeeded' && publication.outcome !== 'succeeded') continue;
			result.set(key(publication), { ...publication, required: old?.required || publication.required });
		}
		return [...result.values()];
	});
}

export function validatePublicationIdentity(
	execution: Execution,
	publication: Publication,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const identity = yield* Effect.fromResult(parseIdentity(publication, execution.repository)).pipe(
			Effect.mapError(toDomainError),
		);
		if (!matchesPackage(publication.id, { ...publication, identity })) {
			return yield* precondition('Publication ID does not match its manager and package identity');
		}
		if (
			execution.version && managerSpec(publication.manager).versionPolicy === 'equals-execution'
			&& publication.version !== execution.version
		) {
			return yield* precondition('Publication version does not match the execution');
		}
	});
}

export function dependenciesReady(execution: Execution, candidates: Execution[]): boolean {
	return execution.dependencies.every(id =>
		candidates.some(dependency =>
			dependency.id === id
			&& dependency.state === 'succeeded' && dependency.repositoryId === execution.repositoryId
			&& dependency.eventId === execution.eventId && dependency.sourceSha === execution.sourceSha
			&& dependency.configurationSha === execution.configurationSha
		)
	);
}
