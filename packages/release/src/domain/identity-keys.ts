import type { Effect } from 'effect';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { encodeConfigurationV1 } from '@/persistence/codecs/configuration';
import type { Execution, ReleasePlan } from '@/release/domain/execution/types.ts';
import type { ReleaseSetPlan } from '@/release/domain/planning/plan.ts';

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
			configuration: provenance?.configuration && encodeConfigurationV1(provenance.configuration),
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
