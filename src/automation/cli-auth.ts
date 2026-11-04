import type { AuthBindings } from '@/automation/auth';
import { unauthenticated } from '@/contract/errors';
import { cliToken, cliTokenPattern, confirmationCode, loginSecretPattern, sha256Hex } from '@/contract/ids';
import { record, string } from '@/model';
import { CLISessionStore } from '@/persistence/d1/cli-sessions';
import { SessionStore } from '@/persistence/d1/sessions';

type CLIEnvironment = Pick<AuthBindings, 'ADMIN_SUBJECT'> & Partial<Pick<AuthBindings, 'DB'>>;
export async function cliSubject(request: Request, env: CLIEnvironment): Promise<string> {
	const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
	if (!token || !cliTokenPattern.test(token) || !env.DB) throw unauthenticated('CLI login required');
	const subject = await new CLISessionStore(env.DB).subject(await sha256Hex(token));
	if (!subject || !env.ADMIN_SUBJECT || subject !== env.ADMIN_SUBJECT) {
		throw unauthenticated('CLI session revoked; run beepboop auth login');
	}
	return subject;
}

/** Browser approval and a one-time, verifier-bound exchange, using the existing OAuth login. */
export async function cliAuthRoute(
	request: Request,
	env: AuthBindings,
	verify: (request: Request, env: AuthBindings) => Promise<string>,
): Promise<Response> {
	const url = new URL(request.url);
	const json = (value: unknown, status = 200) =>
		Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
	if (url.pathname === '/auth/cli/token' && request.method === 'POST') {
		const verifier = await request.text();
		if (!loginSecretPattern.test(verifier)) return json({ error: 'Invalid login verifier' }, 400);
		const document = await new SessionStore(env.DB).take(`cli-approval:${await sha256Hex(verifier)}`);
		if (document === undefined) return json({ pending: true }, 202);
		const approval = record(JSON.parse(document));
		if (approval.subject !== env.ADMIN_SUBJECT) return json({ error: 'Access denied' }, 403);
		const token = cliToken();
		// Store only hashes of terminal credentials; the browser never receives them.
		await new CLISessionStore(env.DB).create(await sha256Hex(token), string(approval.subject));
		return json({ token });
	}
	if (url.pathname === '/auth/cli/logout' && request.method === 'POST') {
		try {
			await cliSubject(request, env);
		} catch {
			return json({ error: 'CLI session revoked' }, 401);
		}
		const token = request.headers.get('authorization')?.slice(7) ?? '';
		await new CLISessionStore(env.DB).revoke(await sha256Hex(token));
		return json({ ok: true });
	}
	if (url.pathname === '/auth/cli/status' && request.method === 'GET') {
		try {
			return json({ subject: await cliSubject(request, env) });
		} catch {
			return json({ error: 'CLI session revoked' }, 401);
		}
	}
	if (url.pathname !== '/auth/cli/authorize' || !['GET', 'POST'].includes(request.method)) {
		return json({ error: 'Not found' }, 404);
	}
	const challenge = url.searchParams.get('challenge');
	if (!challenge || !loginSecretPattern.test(challenge)) return json({ error: 'Invalid login challenge' }, 400);
	// Approval must come from the signed-in browser, never another terminal session.
	if (request.headers.has('authorization')) return json({ error: 'Browser login required' }, 403);
	let subject: string;
	try {
		subject = await verify(request, env);
	} catch {
		return request.method === 'GET'
			? new Response(null, { status: 302, headers: { Location: `/auth/login?cli=${challenge}` } })
			: json({ error: 'Browser login required' }, 401);
	}
	const approved = request.method === 'POST';
	if (approved) {
		if (request.headers.get('origin') !== env.APPLICATION_ORIGIN) return json({ error: 'Invalid origin' }, 403);
		await new SessionStore(env.DB).offer('cli-approval', `cli-approval:${challenge}`, { subject }, 300000);
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
}
