import { Clock, Effect } from 'effect';
import { cliSubject } from '@/auth/cli-sessions.ts';
import { accessCookie, cookie } from '@/auth/cookies.ts';
import { verified } from '@/auth/jwt.ts';
import type { AuthBindings, AuthenticationDependencies } from '@/auth/service.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden, unauthenticated } from '@/kernel/errors/domain-error.ts';

export function administrator(
	request: Request,
	env:
		& Pick<AuthBindings, 'APPLICATION_ORIGIN' | 'OPENAUTH_ISSUER' | 'OPENAUTH_CLIENT_ID' | 'ADMIN_SUBJECT'>
		& Partial<Pick<AuthBindings, 'DB'>>,
	dependencies: AuthenticationDependencies,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		if (request.headers.has('authorization')) return yield* cliSubject(request, env, dependencies.cliSessions);
		const token = cookie(request, accessCookie);
		if (!token || token.length > 20000) return yield* unauthenticated('Administrator login required');
		const now = yield* Clock.currentTimeMillis;
		const { claims: payload } = yield* verified(token, {
			key: dependencies.administratorKeys,
			algorithms: ['ES256', 'RS256'],
			tokenType: { unchecked: true },
			claims: {
				issuer: env.OPENAUTH_ISSUER,
				now: () => new Date(now),
				audience: env.OPENAUTH_CLIENT_ID,
				requiredClaims: ['exp', 'sub'],
				futureIssuedAt: 'allow',
			},
		});
		if (payload.mode !== 'access' || payload.type !== 'user') {
			return yield* unauthenticated('Administrator access token required');
		}
		if (!env.ADMIN_SUBJECT || payload.sub !== env.ADMIN_SUBJECT) {
			return yield* forbidden('Administrator access denied');
		}
		if (request.method !== 'GET' && request.headers.get('origin') !== env.APPLICATION_ORIGIN) {
			return yield* forbidden('Invalid request origin');
		}
		return payload.sub;
	});
}
