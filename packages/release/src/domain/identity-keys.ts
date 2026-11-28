import type { Effect } from 'effect';
import { Struct } from 'effect';
import { configurationValue } from '@/domain/configuration/schema.ts';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { encodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Execution, ReleasePlan } from '@/release/domain/execution/types.ts';
import type { ReleaseSetPlan } from '@/release/domain/planning/plan.ts';

const identifiedConfiguration = mutableStruct(Struct.omit(configurationValue.fields, ['actionsRevision']));

export function executionId(
	repositoryId: number,
	stream: string,
	operation: string,
	eventId: string,
): Effect.Effect<string, DomainError> {
	return fromPromise(() => sha256Hex(JSON.stringify([repositoryId, stream, operation, eventId])));
}

export function planIdentity(
	plan: ReleasePlan | ReleaseSetPlan,
	provenance?: Pick<RepositoryRecord, 'configuration' | 'presetShas'>,
): Effect.Effect<string, DomainError> {
	return fromPromise(() =>
		sha256Hex(JSON.stringify({
			plan,
			configuration: provenance?.configuration && encodeSync(identifiedConfiguration, provenance.configuration),
			presetShas: provenance?.presetShas,
		}))
	);
}

export function releaseEventId(
	execution: Pick<Execution, 'repositoryId' | 'stream' | 'configurationSha' | 'sourceSha' | 'releaseSet'> & {
		version: string;
	},
): string {
	return `release:${execution.repositoryId}:${execution.stream}:${execution.configurationSha}:${execution.sourceSha}:${execution.version}${
		execution.releaseSet ? `:${execution.releaseSet.preparationId}:${execution.releaseSet.group}` : ''
	}`;
}

export function sameReleaseEvent(
	left: Pick<Execution, 'repositoryId' | 'eventId' | 'sourceSha' | 'configurationSha'>,
	right: Pick<Execution, 'repositoryId' | 'eventId' | 'sourceSha' | 'configurationSha'>,
): boolean {
	return left.repositoryId === right.repositoryId && left.eventId === right.eventId
		&& left.sourceSha === right.sourceSha && left.configurationSha === right.configurationSha;
}
