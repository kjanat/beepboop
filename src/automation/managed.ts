import { Effect } from 'effect';
import { createExecution } from '@/automation/execution';
import type { ReleaseSetPlan } from '@/automation/planning';
import type { Execution, ReleasePlan } from '@/automation/types';
import { type DomainError, precondition } from '@/contract/errors';
import type { ReadyRepository } from '@/domain/repository';
import { executionId, planIdentity } from '@/persistence/identity-keys';

export function createReleasePreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		if (!repository.configuration.streams[stream]?.prepare.workflow) {
			return yield* createManagedPreparation(repository, stream, plan);
		}
		if (plan.sourceSha !== repository.sha) return yield* precondition('Preparation source is not available');
		const identity = yield* planIdentity(plan, repository);
		const execution = yield* createExecution(repository, {
			stream,
			operation: 'prepare',
			eventId: `plan:${identity}`,
			sourceSha: repository.sha,
			version: 'version' in plan ? plan.version : undefined,
		});
		execution.plan = structuredClone(plan);
		return execution;
	});
}

export function createManagedPreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const configuration = repository.configuration;
		if (!configuration.streams[stream]) return yield* precondition('Unknown stream');
		if (plan.sourceSha !== repository.sha) return yield* precondition('Preparation source revision changed');
		if (plan.requiresPreparation) return yield* precondition('A preparation workflow must regenerate lockfiles');
		if (!plan.edits.length) return yield* precondition('Preparation has no edits');
		const identity = yield* planIdentity(plan, repository);
		const eventId = `plan:${identity}`;
		const id = yield* executionId(repository.id, stream, 'prepare', eventId);
		const versions = 'version' in plan
			? plan.version
			: plan.groups.map(group => `${group.id} ${group.version}`).join(', ');
		const execution: Execution = {
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
		return execution;
	});
}
