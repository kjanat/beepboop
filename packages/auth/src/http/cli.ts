import { Effect } from 'effect';
import { cliSubject } from '@/auth/cli-sessions.ts';
import { AuthPages } from '@/auth/pages.ts';
import type { AuthBindings, AuthenticationDependencies } from '@/auth/service.ts';
import { fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { responseText } from '@/kernel/http/body.ts';
import { cliToken, confirmationCode, loginSecretPattern, sha256Hex } from '@/kernel/schema/ids.ts';

/** Browser approval and a one-time, verifier-bound exchange, using the existing OAuth login. */
export function cliAuthRoute(
	request: Request,
	env: AuthBindings,
	verify: (request: Request, env: AuthBindings) => Effect.Effect<string, DomainError>,
	dependencies: Pick<AuthenticationDependencies, 'sessions' | 'cliSessions'>,
): Effect.Effect<Response, DomainError, AuthPages> {
	return Effect.gen(function*() {
		const url = new URL(request.url);
		const json = (value: unknown, status = 200) =>
			Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
		if (url.pathname === '/auth/cli/token' && request.method === 'POST') {
			const verifier = yield* responseText(request).pipe(Effect.mapError(({ cause }) => toDomainError(cause)));
			if (!loginSecretPattern.test(verifier)) return json({ error: 'Invalid login verifier' }, 400);
			const hash = yield* fromPromise(() => sha256Hex(verifier));
			const approval = yield* dependencies.sessions.take('cli-approval', `cli-approval:${hash}`);
			if (approval === undefined) return json({ pending: true }, 202);
			if (approval.subject !== env.ADMIN_SUBJECT) return json({ error: 'Access denied' }, 403);
			const token = cliToken();
			// Store only hashes of terminal credentials; the browser never receives them.
			yield* dependencies.cliSessions.create(yield* fromPromise(() => sha256Hex(token)), approval.subject);
			return json({ token });
		}
		if (url.pathname === '/auth/cli/logout' && request.method === 'POST') {
			if (
				!(yield* cliSubject(request, env, dependencies.cliSessions).pipe(
					Effect.as(true),
					Effect.orElseSucceed(() => false),
				))
			) {
				return json({ error: 'CLI session revoked' }, 401);
			}
			const token = request.headers.get('authorization')?.slice(7) ?? '';
			yield* dependencies.cliSessions.revoke(yield* fromPromise(() => sha256Hex(token)));
			return json({ ok: true });
		}
		if (url.pathname === '/auth/cli/status' && request.method === 'GET') {
			return yield* cliSubject(request, env, dependencies.cliSessions).pipe(
				Effect.map(subject => json({ subject })),
				Effect.orElseSucceed(() => json({ error: 'CLI session revoked' }, 401)),
			);
		}
		if (url.pathname !== '/auth/cli/authorize' || !['GET', 'POST'].includes(request.method)) {
			return json({ error: 'Not found' }, 404);
		}
		const challenge = url.searchParams.get('challenge');
		if (!challenge || !loginSecretPattern.test(challenge)) return json({ error: 'Invalid login challenge' }, 400);
		// Approval must come from the signed-in browser, never another terminal session.
		if (request.headers.has('authorization')) return json({ error: 'Browser login required' }, 403);
		const subject = yield* verify(request, env).pipe(Effect.catch(() => Effect.undefined));
		if (subject === undefined) {
			return request.method === 'GET'
				? new Response(null, { status: 302, headers: { Location: `/auth/login?cli=${challenge}` } })
				: json({ error: 'Browser login required' }, 401);
		}
		const approved = request.method === 'POST';
		if (approved) {
			if (request.headers.get('origin') !== env.APPLICATION_ORIGIN) return json({ error: 'Invalid origin' }, 403);
			yield* dependencies.sessions.offer('cli-approval', `cli-approval:${challenge}`, { subject }, 300000);
		}
		const pages = yield* AuthPages;
		return new Response(
			pages.cliApproval(approved ? { _tag: 'Approved' } : { _tag: 'Authorize', code: confirmationCode(challenge) }),
			{
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'Cache-Control': 'no-store',
					'Referrer-Policy': 'no-referrer',
					'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
				},
			},
		);
	});
}
