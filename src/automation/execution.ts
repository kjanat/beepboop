import type { Execution, Publication, RepositoryRecord, WorkflowBinding } from './types.ts';

export async function executionId(
	repositoryId: number,
	stream: string,
	operation: string,
	eventId: string,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([repositoryId, stream, operation, eventId])),
	);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function createExecution(
	repository: RepositoryRecord,
	streamName: string,
	operation: string,
	eventId: string,
	version?: string,
	observed = false,
): Promise<Execution> {
	if (!repository.configuration || repository.diagnostics.length) {
		throw new Error('Repository configuration is not ready');
	}
	const stream = repository.configuration.streams[streamName];
	if (!stream) throw new Error('Unknown stream');
	const binding: WorkflowBinding | undefined = operation === 'prepare'
		? stream.prepare.workflow
		: operation === 'promote'
		? stream.promote.workflow
		: stream.workflows[operation];
	if (!binding) throw new Error('Operation has no workflow binding');
	const workflow = repository.inventory.workflows.find((w) => w.file === binding.file);
	if (
		!observed
		&& (!workflow?.events.includes('workflow_dispatch')
			|| !workflow.dispatchInputs.includes('beepboop_execution_id')
			|| binding.mode === 'observe')
	) {
		throw new Error('Workflow needs workflow_dispatch and beepboop_execution_id');
	}
	return {
		id: await executionId(repository.id, streamName, operation, eventId),
		repositoryId: repository.id,
		repository: repository.name,
		stream: streamName,
		operation,
		eventId,
		configuration: structuredClone(repository.configuration),
		configurationSha: repository.sha,
		presetShas: { ...repository.presetShas },
		sourceSha: repository.sha,
		...(version ? { version } : {}),
		state: observed ? 'pending' : operation === 'promote' ? 'blocked' : 'ready',
		dependencies: await Promise.all(
			(binding.needs ?? []).map((operation) => executionId(repository.id, streamName, operation, eventId)),
		),
		workflow: { ...binding, ref: binding.ref ?? repository.defaultBranch },
		attempts: 0,
		publications: [],
		artifacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}
export function completion(execution: Execution, runSucceeded: boolean): Execution['state'] {
	if (!runSucceeded) return 'failed';
	const required = execution.workflow.publications
		?? (execution.operation === 'publish'
			? (execution.configuration.streams[execution.stream]?.required ?? [])
			: []);
	if (required.some((id) => !execution.publications.some((p) => p.id === id))) return 'blocked';
	const publications = execution.publications.filter((p) => p.required || required.includes(p.id));
	if (publications.some((p) => p.outcome === 'failed')) return 'failed';
	if (publications.some((p) => p.outcome === 'uncertain')) return 'uncertain';
	if (publications.some((p) => p.outcome !== 'succeeded')) return 'blocked';
	return 'succeeded';
}
export function mergePublications(prior: Publication[], incoming: Publication[]): Publication[] {
	const result = new Map(prior.map((p) => [p.id, p]));
	for (const publication of incoming) {
		const old = result.get(publication.id);
		if (
			old
			&& (old.manager !== publication.manager
				|| old.name !== publication.name
				|| old.version !== publication.version
				|| (old.digest && publication.digest && old.digest !== publication.digest))
		) {
			throw new Error('Publication identity changed');
		}
		if (old?.outcome === 'succeeded' && publication.outcome !== 'succeeded') continue;
		result.set(publication.id, { ...publication, required: old?.required || publication.required });
	}
	return [...result.values()];
}
