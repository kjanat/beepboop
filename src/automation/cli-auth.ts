import { Effect } from 'effect';
import type { AuthBindings } from '@/automation/auth';
import { type DomainError, unauthenticated } from '@/contract/errors';
import { cliToken, cliTokenPattern, confirmationCode, loginSecretPattern, sha256Hex } from '@/contract/ids';
import { fromPromise, fromSync } from '@/failure';
import { record, string } from '@/model';
import { CLISessionStore } from '@/persistence/d1/cli-sessions';
import { SessionStore } from '@/persistence/d1/sessions';

type CLIEnvironment = Pick<AuthBindings, 'ADMIN_SUBJECT'> & Partial<Pick<AuthBindings, 'DB'>>;
export function cliSubject(request: Request, env: CLIEnvironment): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
		const db = env.DB;
		if (!token || !cliTokenPattern.test(token) || !db) return yield* unauthenticated('CLI login required');
		const hash = yield* fromPromise(() => sha256Hex(token));
		const subject = yield* new CLISessionStore(db).subject(hash);
		if (!subject || !env.ADMIN_SUBJECT || subject !== env.ADMIN_SUBJECT) {
			return yield* unauthenticated('CLI session revoked; run beepboop auth login');
		}
		return subject;
	});
}

/** Browser approval and a one-time, verifier-bound exchange, using the existing OAuth login. */
export function cliAuthRoute(
	request: Request,
	env: AuthBindings,
	verify: (request: Request, env: AuthBindings) => Effect.Effect<string, DomainError>,
): Effect.Effect<Response, DomainError> {
	return Effect.gen(function*() {
		const url = new URL(request.url);
		const json = (value: unknown, status = 200) =>
			Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
		if (url.pathname === '/auth/cli/token' && request.method === 'POST') {
			const verifier = yield* fromPromise(() => request.text());
			if (!loginSecretPattern.test(verifier)) return json({ error: 'Invalid login verifier' }, 400);
			const hash = yield* fromPromise(() => sha256Hex(verifier));
			const document = yield* new SessionStore(env.DB).take(`cli-approval:${hash}`);
			if (document === undefined) return json({ pending: true }, 202);
			const approval = yield* fromSync(() => record(JSON.parse(document)));
			if (approval.subject !== env.ADMIN_SUBJECT) return json({ error: 'Access denied' }, 403);
			const token = cliToken();
			const subject = yield* fromSync(() => string(approval.subject));
			// Store only hashes of terminal credentials; the browser never receives them.
			yield* new CLISessionStore(env.DB).create(yield* fromPromise(() => sha256Hex(token)), subject);
			return json({ token });
		}
		if (url.pathname === '/auth/cli/logout' && request.method === 'POST') {
			if (!(yield* cliSubject(request, env).pipe(Effect.as(true), Effect.orElseSucceed(() => false)))) {
				return json({ error: 'CLI session revoked' }, 401);
			}
			const token = request.headers.get('authorization')?.slice(7) ?? '';
			yield* new CLISessionStore(env.DB).revoke(yield* fromPromise(() => sha256Hex(token)));
			return json({ ok: true });
		}
		if (url.pathname === '/auth/cli/status' && request.method === 'GET') {
			return yield* cliSubject(request, env).pipe(
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
			yield* new SessionStore(env.DB).offer('cli-approval', `cli-approval:${challenge}`, { subject }, 300000);
		}
		return new Response(
			`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop CLI login</title><main><h1>${
				approved ? 'Terminal approved' : 'Authorize Beepboop CLI'
			}</h1>${
				approved
					? '<p>Return to your terminal. You can close this page.</p>'
					: `<p>Only approve if you just ran beepboop auth login in your own terminal. This grants administrator API access until you run beepboop auth logout. Security-key checks still apply.</p><p>Confirm this code matches your terminal: <strong>${
						confirmationCode(challenge)
					}</strong></p><form method="post"><button>Authorize my terminal</button></form>`
			}</main></html>`,
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
