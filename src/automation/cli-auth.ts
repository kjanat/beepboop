import type { AuthBindings } from '@/automation/auth';
import { record, string } from '@/model';

/** Store only hashes of terminal credentials; the browser never receives them. */
export async function credentialHash(value: string): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
		.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

type CLIEnvironment = Pick<AuthBindings, 'ADMIN_SUBJECT'> & Partial<Pick<AuthBindings, 'DB'>>;
export async function cliSubject(request: Request, env: CLIEnvironment): Promise<string> {
	const token = request.headers.get('authorization')?.match(/^Bearer (cli_[a-f0-9]{64})$/)?.[1];
	if (!token || !env.DB) throw new Error('CLI login required');
	const row = await env.DB.prepare('SELECT subject FROM cli_sessions WHERE id=?')
		.bind(await credentialHash(token)).first();
	const subject = row ? string(row.subject) : undefined;
	if (!subject || !env.ADMIN_SUBJECT || subject !== env.ADMIN_SUBJECT) {
		throw new Error('CLI session revoked; run beepboop auth login');
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
		if (!/^[a-f0-9]{64}$/.test(verifier)) return json({ error: 'Invalid login verifier' }, 400);
		const row = await env.DB.prepare('DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document')
			.bind(`cli-approval:${await credentialHash(verifier)}`, Date.now()).first();
		if (!row) return json({ pending: true }, 202);
		const approval = record(JSON.parse(string(row.document)));
		if (approval.subject !== env.ADMIN_SUBJECT) return json({ error: 'Access denied' }, 403);
		const token = `cli_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
		await env.DB.prepare('INSERT INTO cli_sessions VALUES(?,?,?)')
			.bind(await credentialHash(token), string(approval.subject), Date.now())
			.run();
		return json({ token });
	}
	if (url.pathname === '/auth/cli/logout' && request.method === 'POST') {
		try {
			await cliSubject(request, env);
		} catch {
			return json({ error: 'CLI session revoked' }, 401);
		}
		const token = request.headers.get('authorization')?.slice(7) ?? '';
		await env.DB.prepare('DELETE FROM cli_sessions WHERE id=?').bind(await credentialHash(token)).run();
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
	if (!challenge || !/^[a-f0-9]{64}$/.test(challenge)) return json({ error: 'Invalid login challenge' }, 400);
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
		await env.DB.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?)')
			.bind(`cli-approval:${challenge}`, JSON.stringify({ subject }), Date.now() + 300000).run();
	}
	return new Response(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop CLI login</title><main><h1>${
			approved ? 'Terminal approved' : 'Authorize Beepboop CLI'
		}</h1>${
			approved
				? '<p>Return to your terminal. You can close this page.</p>'
				: `<p>Only approve if you just ran beepboop auth login in your own terminal. This grants administrator API access until you run beepboop auth logout. Security-key checks still apply.</p><p>Confirm this code matches your terminal: <strong>${
					challenge.slice(0, 8)
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
