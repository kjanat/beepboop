import { Effect } from 'effect';
import type { VerifiedJwt, VerifyJwtOptions } from 'micro509/jose';
import { verifyJwt } from 'micro509/jose';
import { fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { unauthenticated, upstream } from '@/kernel/errors/domain-error.ts';

export function verified(
	token: string,
	options: Omit<VerifyJwtOptions, 'signal'>,
): Effect.Effect<VerifiedJwt, DomainError> {
	return fromPromise(signal => verifyJwt(token, { ...options, signal })).pipe(Effect.flatMap(result => {
		if (result.ok) return Effect.succeed(result.value);
		switch (result.code) {
			case 'aborted':
				return Effect.interrupt;
			case 'invalid_options':
			case 'key_resolution_failed':
				return Effect.fail(toDomainError(new Error(result.message)));
			case 'jwks_unavailable':
				return Effect.fail(upstream('oidc', result.message));
			default:
				return Effect.fail(unauthenticated(result.message));
		}
	}));
}

export function boundedToken(token: string | undefined): token is string {
	return !!token && token.length <= 20_000;
}
