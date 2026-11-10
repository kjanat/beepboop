import { Effect } from 'effect';
import { createExecution } from '@/automation/execution';
import type { ReleaseSetPlan } from '@/automation/planning';
import type { Execution, ReleasePlan, ReleaseStarted } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { startLabels } from '@/contract/release-start';
import { publishWhenNames, publishWhenSentences } from '@/contract/setup-terms';
import type { ReadyRepository } from '@/domain/repository';
import { executionId, planIdentity } from '@/persistence/identity-keys';

export function preparationBody(execution: Pick<Execution, 'configuration' | 'stream' | 'started'>): string {
	const { started } = execution;
	if (started) {
		return `Started from ${startLabels[started.via]}. Merging this PR publishes the release, and nothing asks again.`;
	}
	const policy = execution.configuration.streams[execution.stream]?.promote.approval ?? 'required';
	return `\`publishWhen: ${publishWhenNames[policy]}\`: ${publishWhenSentences[policy]}`;
}

export function createReleasePreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
	started?: ReleaseStarted,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		if (!repository.configuration.streams[stream]?.prepare.workflow) {
			return yield* createManagedPreparation(repository, stream, plan, started);
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
		if (started) execution.started = started;
		return execution;
	});
}

export function createManagedPreparation(
	repository: ReadyRepository,
	stream: string,
	plan: ReleasePlan | ReleaseSetPlan,
	started?: ReleaseStarted,
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
			...(started ? { started } : {}),
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
				body: `Prepare ${versions}\n\nSource: ${plan.sourceSha}\nPlan: ${identity}\n\n${
					preparationBody({ configuration, stream, ...(started ? { started } : {}) })
				}`,
			},
		};
		return execution;
	});
}
