import { createExecution } from '@/automation/execution';
import type { ReleaseSetPlan } from '@/automation/planning';
import type { Execution, ReleasePlan } from '@/automation/types';
import type { ReadyRepository } from '@/domain/repository';
import { executionId, planIdentity } from '@/persistence/identity-keys';

export async function createReleasePreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Promise<Execution> {
	if (!repository.configuration.streams[stream]?.prepare.workflow) {
		return createManagedPreparation(repository, stream, plan);
	}
	if (plan.sourceSha !== repository.sha) throw new Error('Preparation source is not available');
	const identity = await planIdentity(plan, repository);
	const execution = await createExecution(repository, {
		stream,
		operation: 'prepare',
		eventId: `plan:${identity}`,
		sourceSha: repository.sha,
		version: 'version' in plan ? plan.version : undefined,
	});
	execution.plan = structuredClone(plan);
	return execution;
}

export async function createManagedPreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Promise<Execution> {
	const configuration = repository.configuration;
	if (!configuration.streams[stream]) throw new Error('Unknown stream');
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
