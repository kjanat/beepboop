import type { Effect } from 'effect';
import type { ReleaseSetPlan } from '@/automation/planning';
import type { Execution, ReleasePlan, RepositoryRecord } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { fromPromise } from '@/failure';
import { encodeConfigurationV1 } from '@/persistence/codecs/configuration';

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
