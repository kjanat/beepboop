import { Effect, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { mutableStruct } from '@/schema';

export const immutableReleaseSettingsSchema = Schema.NullOr(mutableStruct({ enabled: Schema.Boolean }));

export function requireImmutableReleases({ gateway, repository, token, required = false }: {
	gateway: Pick<RepositoryGateway, 'read'>;
	repository: string;
	token: string;
	required?: boolean;
}): Effect.Effect<void, DomainError> {
	if (!required) return Effect.void;
	return gateway.read(immutableReleaseSettingsSchema, `/repos/${repository}/immutable-releases`, token).pipe(
		Effect.flatMap(settings =>
			settings?.enabled === true
				? Effect.void
				: Effect.fail(precondition(`Enable immutable GitHub releases for ${repository} before publishing`))
		),
	);
}

export function verifyImmutableRelease(
	release: { immutable?: boolean },
	required = false,
): Effect.Effect<void, DomainError> {
	return required && release.immutable !== true
		? Effect.fail(precondition('Published GitHub release is not immutable'))
		: Effect.void;
}
