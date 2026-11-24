import { createClient } from '@kjanat/openauth/client';
import { Context, Effect } from 'effect';
import type { JwsKeyResolver } from 'micro509/jose';
import { AuthenticatorStore } from '@/auth/adapters/d1/authenticators.ts';
import { CLISessionStore } from '@/auth/adapters/d1/cli-sessions.ts';
import { SessionStore } from '@/auth/adapters/d1/sessions.ts';
import { remoteKeys } from '@/auth/jwks.ts';
import { Authenticators } from '@/auth/webauthn.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';

export interface AuthBindings {
	DB: SqlDatabase;
	APPLICATION_ORIGIN: string;
	OPENAUTH_ISSUER: string;
	OPENAUTH_CLIENT_ID: string;
	ADMIN_SUBJECT: string;
}
export interface AuthenticationDependencies {
	readonly sessions: SessionStore;
	readonly cliSessions: CLISessionStore;
	readonly authenticators: Authenticators;
	readonly client: (signal: AbortSignal) => ReturnType<typeof createClient>;
	readonly administratorKeys: JwsKeyResolver;
	readonly workflowKeys: JwsKeyResolver;
}
export class Authentication
	extends Context.Service<Authentication, AuthenticationDependencies>()('beepboop/Authentication')
{}

export const authentication = Effect.fnUntraced(function*(
	env: AuthBindings,
	db: Sql,
	transport: Fetcher,
): Effect.fn.Return<AuthenticationDependencies> {
	const sessions = new SessionStore(db);
	const http = (signal: AbortSignal): Fetcher => (input, init) => transport(input, {
		...init,
		signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
	});
	return {
		sessions,
		cliSessions: new CLISessionStore(db),
		authenticators: new Authenticators(env, new AuthenticatorStore(db), sessions),
		client: signal =>
			createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER, fetch: http(signal) }),
		administratorKeys: yield* remoteKeys(new URL('/.well-known/jwks.json', env.OPENAUTH_ISSUER), transport),
		workflowKeys: yield* remoteKeys(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'), transport),
	};
});
