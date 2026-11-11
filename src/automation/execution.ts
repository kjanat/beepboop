import { Effect } from 'effect';
import { canVerifyPublication } from '@/automation/managers';
import { outputsComplete } from '@/automation/outputs';
import { matchesPackage, matchesPublication, packageId, parseIdentity } from '@/automation/package-identity';
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
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import type { ReadyRepository } from '@/domain/repository';
import { toDomainError } from '@/failure';
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
			...(workflow?.dispatchInputs.includes('beepboop_title') ? { titled: true } : {}),
			attempts: 0,
			publications: [],
			artifacts: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
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
export function publishedAfterFailure(execution: Execution): Execution | undefined {
	if (execution.state !== 'failed' || execution.runId === undefined) return undefined;
	const settled = settle(execution, false);
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
