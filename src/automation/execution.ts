import { Clock, Effect } from 'effect';
import type { GitHubRunResult } from '@/automation/github-state';
import { githubFailureReason, githubRunLabel } from '@/automation/github-state';
import { canVerifyPublication } from '@/automation/managers';
import { outputsComplete } from '@/automation/outputs';
import { matchesPackage, matchesPublication, packageId, parseIdentity } from '@/automation/package-identity';
import { freezePackageTags, packageTagGroups } from '@/automation/package-tags';
import { streamModuleTags } from '@/automation/refs';
import type {
	Configuration,
	DiscoveredWorkflow,
	Execution,
	Package,
	Publication,
	ReleaseReference,
	RepositoryRecord,
	WorkflowBinding,
} from '@/automation/types';
import { managerSpec } from '@/contract/catalog';
import type { ReadyRepository } from '@/domain/repository';
import { toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { executionId } from '@/persistence/identity-keys';

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
function requiredIds(execution: Execution): readonly string[] {
	return execution.workflow?.publications
		?? (execution.operation === 'publish'
			? (execution.configuration.streams[execution.stream]?.required ?? [])
			: []);
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
	if (requiredIds(execution).some((id) => !execution.publications.some((p) => matchesPublication(id, p)))) {
		return 'blocked';
	}
	const publications = requiredPublications(execution);
	if (publications.some((p) => p.outcome === 'failed')) return 'failed';
	if (publications.some((p) => p.outcome === 'uncertain')) return 'uncertain';
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
	if (settled.state === 'succeeded') {
		if (succeeded) delete settled.reason;
		else if (result.observation.kind !== 'failed') {
			settled.reason = `${githubRunLabel(result.observation)} after every required publication succeeded.`;
		}
	} else if (!succeeded) {
		if (result.observation.kind === 'action-required') settled.state = 'blocked';
		else if (result.observation.kind === 'unknown') settled.state = 'uncertain';
		settled.reason = githubFailureReason(result);
	}
	return settled;
}
export function publishedAfterFailure(execution: Execution): Execution | undefined {
	if (execution.state !== 'failed' || execution.runId === undefined) return undefined;
	const settled = execution.github?.completed
		? settleRun(execution, { observation: execution.github, jobs: [], retry: undefined })
		: settle(execution, false);
	return settled.state === 'succeeded' ? settled : undefined;
}
export function recheckable(publication: Publication): boolean {
	return canVerifyPublication(publication.manager) && ['pending', 'uncertain'].includes(publication.outcome);
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
