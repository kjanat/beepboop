import { Clock, Effect } from 'effect';
import { startLabels } from '@/domain/release-start.ts';
import type { ReadyRepository } from '@/domain/repository';
import { publishWhenNames, publishWhenSentences } from '@/domain/setup-terms.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { createExecution } from '@/release/domain/execution/execution.ts';
import type { Execution, ReleasePlan, ReleaseStarted } from '@/release/domain/execution/types.ts';
import { executionId, planIdentity } from '@/release/domain/identity-keys.ts';
import type { ReleaseSetPlan } from '@/release/domain/planning/plan.ts';

export function preparationBody(execution: Pick<Execution, 'configuration' | 'stream' | 'started'>): string {
	const { started } = execution;
	if (started) {
		return `Started from ${startLabels[started.via]}. Merging this PR publishes the release, and nothing asks again.`;
	}
	const policy = execution.configuration.streams[execution.stream]?.release.approval ?? 'required';
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
		const clock = yield* Clock.Clock;

		const configuration = repository.configuration;
		if (!configuration.streams[stream]) return yield* precondition('Unknown stream');
		if (plan.sourceSha !== repository.sha) return yield* precondition('Preparation source revision changed');
		if (plan.requiresPreparation) {
			return yield* precondition(
				`Lockfiles need regenerating and ${stream} has no preparation workflow. Add one in release setup.`,
			);
		}
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
			createdAt: clock.currentTimeMillisUnsafe(),
			updatedAt: clock.currentTimeMillisUnsafe(),
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
