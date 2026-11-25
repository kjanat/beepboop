import { Effect } from 'effect';
import type { RefState } from '@/domain/refs.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { DistributionArtifact } from '@/release/distribution/artifact.ts';
import type { DistributionFile } from '@/release/distribution/validation.ts';

export type RefsRequest =
	| { readonly _tag: 'PlanRefs'; readonly files: readonly DistributionFile[] }
	| { readonly _tag: 'PlanFromArtifact'; readonly artifact: DistributionArtifact }
	| { readonly _tag: 'CompleteRefs'; readonly versionTag?: RefState };

export function refsRequest(
	complete: boolean,
	files: readonly DistributionFile[],
	artifact: DistributionArtifact | undefined,
	versionTag?: RefState,
): Effect.Effect<RefsRequest, DomainError> {
	if (versionTag && !complete) return Effect.fail(precondition('Version tag supplied before ref confirmation'));
	if (artifact) {
		return complete || files.length
			? Effect.fail(precondition('Unexpected distribution artifact'))
			: Effect.succeed({ _tag: 'PlanFromArtifact', artifact });
	}
	return Effect.succeed(
		complete ? { _tag: 'CompleteRefs', ...(versionTag ? { versionTag } : {}) } : { _tag: 'PlanRefs', files },
	);
}
