import { createExecution, executionId } from './execution.ts';
import type { ReleaseSetPlan } from './planning.ts';
import type { Execution, ReleasePlan, RepositoryRecord } from './types.ts';

export async function planIdentity(
	plan: ReleasePlan | ReleaseSetPlan,
	provenance?: Pick<RepositoryRecord, 'configuration' | 'presetShas'>,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify({
			plan,
			configuration: provenance?.configuration,
			presetShas: provenance?.presetShas,
		})),
	);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createReleasePreparation(
	repository: RepositoryRecord,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Promise<Execution> {
	if (!repository.configuration?.streams[stream]?.prepare.workflow) {
		return createManagedPreparation(repository, stream, plan);
	}
	if (repository.suspended || plan.sourceSha !== repository.sha) throw new Error('Preparation source is not available');
	const identity = await planIdentity(plan, repository);
	const execution = await createExecution(
		repository,
		stream,
		'prepare',
		`plan:${identity}`,
		'version' in plan ? plan.version : undefined,
	);
	execution.plan = structuredClone(plan);
	return execution;
}

export async function createManagedPreparation(
	repository: RepositoryRecord,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Promise<Execution> {
	const configuration = repository.configuration;
	if (!configuration?.streams[stream] || repository.diagnostics.length || repository.suspended) {
		throw new Error('Repository configuration is not ready');
	}
	if (plan.sourceSha !== repository.sha) throw new Error('Preparation source revision changed');
	if (plan.requiresPreparation) throw new Error('A preparation workflow must regenerate lockfiles');
	if (!plan.edits.length) throw new Error('Preparation has no edits');
	const identity = await planIdentity(plan, repository);
	const eventId = `plan:${identity}`;
	const id = await executionId(repository.id, stream, 'prepare', eventId);
	const versions = 'version' in plan
		? plan.version
		: plan.groups.map(group => `${group.id} ${group.version}`).join(', ');
	return {
		id,
		repositoryId: repository.id,
		repository: repository.name,
		stream,
		operation: 'prepare',
		eventId,
		configuration: structuredClone(configuration),
		configurationSha: repository.sha,
		presetShas: { ...repository.presetShas },
		sourceSha: plan.sourceSha,
		...('version' in plan ? { version: plan.version } : {}),
		state: 'ready',
		dependencies: [],
		attempts: 0,
		publications: [],
		artifacts: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		managed: {
			kind: 'prepare',
			plan: structuredClone(plan),
			branch: `release/${stream}/${identity}`,
			title: `chore(release): prepare ${versions}`,
			body: `Prepare ${versions}\n\nSource: ${plan.sourceSha}\nPlan: ${identity}\n\nPromotion requires approval.`,
		},
	};
}
