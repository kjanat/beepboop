import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthBindings } from '@/automation/auth';
import { administrator, completeLogin } from '@/automation/auth';
import { cliAuthRoute, credentialHash } from '@/automation/cli-auth';
import { Client, serverOrigin } from '@/cli/client';

function fixture() {
	const sqlite = new Database(':memory:');
	sqlite.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, document TEXT, expires_at INTEGER)');
	const DB = {
		prepare(sql: string) {
			return {
				bind(...args: (string | number)[]) {
					return {
						async first() {
							return sqlite.query(sql).get(...args);
						},
						async run() {
							return sqlite.query(sql).run(...args);
						},
					};
				},
			};
		},
	} as unknown as D1Database;
	const env: AuthBindings = {
		DB,
		APPLICATION_ORIGIN: 'https://beepboop.test',
		OPENAUTH_ISSUER: 'https://issuer.test',
		OPENAUTH_CLIENT_ID: 'beepboop',
		ADMIN_SUBJECT: 'admin',
	};
	return { sqlite, env };
}

test('CLI approval requires browser identity and origin; exchange is verifier-bound, single-use and revocable', async () => {
	const { sqlite, env } = fixture();
	const verifier = 'ab'.repeat(32);
	const challenge = await credentialHash(verifier);
	const url = `${env.APPLICATION_ORIGIN}/auth/cli/authorize?challenge=${challenge}`;
	const verify = async (request: Request) => {
		if (request.headers.get('cookie') !== 'signed-in') throw Error('not signed in');
		return 'admin';
	};
	const route = (request: Request) => cliAuthRoute(request, env, verify);
	const exchange = (value = verifier) =>
		route(new Request(`${env.APPLICATION_ORIGIN}/auth/cli/token`, { method: 'POST', body: value }));
	try {
		expect((await route(new Request(url))).headers.get('Location')).toBe(`/auth/login?cli=${challenge}`);
		expect((await exchange()).status).toBe(202);
		expect((await route(new Request(url, { method: 'POST', headers: { cookie: 'signed-in' } }))).status).toBe(403);
		const page = await route(new Request(url, { headers: { cookie: 'signed-in' } }));
		expect(await page.text()).toContain(challenge.slice(0, 8));
		expect((await exchange()).status).toBe(202); // A GET never approves.
		expect(
			(await route(
				new Request(url, { method: 'POST', headers: { cookie: 'signed-in', origin: env.APPLICATION_ORIGIN } }),
			)).status,
		).toBe(200);
		expect((await exchange('cd'.repeat(32))).status).toBe(202);
		const { token } = await (await exchange()).json() as { token: string };
		expect((await exchange()).status).toBe(202);
		const authorized = new Request(`${env.APPLICATION_ORIGIN}/api/repositories`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(await administrator(authorized, env)).toBe('admin');
		await expect(administrator(authorized, { ...env, ADMIN_SUBJECT: 'other' })).rejects.toThrow();
		expect(JSON.stringify(sqlite.query('SELECT * FROM sessions').all())).not.toContain(token);
		await route(
			new Request(`${env.APPLICATION_ORIGIN}/auth/cli/logout`, { method: 'POST', headers: authorized.headers }),
		);
		await expect(administrator(authorized, env)).rejects.toThrow();
	} finally {
		sqlite.close();
	}
});

test('unapproved, expired and forged CLI credentials cannot authenticate', async () => {
	const { sqlite, env } = fixture();
	try {
		const token = `cli_${'ab'.repeat(32)}`;
		sqlite.query('INSERT INTO sessions VALUES(?,?,?)').run(
			`cli:${await credentialHash(token)}`,
			JSON.stringify({ kind: 'cli', subject: 'admin' }),
			Date.now() - 1,
		);
		for (const value of [token, 'garbage']) {
			await expect(
				administrator(new Request(env.APPLICATION_ORIGIN, { headers: { authorization: `Bearer ${value}` } }), env),
			).rejects.toThrow();
		}
	} finally {
		sqlite.close();
	}
});

test('CLI credentials are private, isolated by server, and never sent to redirects', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-cli-'));
	let received = '';
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			received = request.headers.get('authorization') ?? '';
			return Response.redirect('https://example.com');
		},
	});
	try {
		const client = new Client(server.url.origin, directory);
		const session = { token: `cli_${'ab'.repeat(32)}`, expiresAt: Date.now() + 60000 };
		await client.save(session);
		expect(await client.session()).toEqual(session);
		const [file] = await readdir(directory);
		expect((await stat(join(directory, file ?? 'missing'))).mode & 0o777).toBe(0o600);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		await expect(new Client('https://different.test', directory).session()).rejects.toThrow('Not signed in');
		await expect(client.request('/api/repositories')).rejects.toThrow();
		expect(received).toBe(`Bearer ${session.token}`);
		expect(() => serverOrigin('http://example.com')).toThrow();
		expect(() => serverOrigin('https://user:pass@example.com')).toThrow();
	} finally {
		server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
});

test('DreamCLI routes all release commands and validates required flags before network access', async () => {
	for (const name of ['plan', 'prepare', 'start']) {
		const process = Bun.spawn(['bun', 'src/cli/cli.ts', 'releases', name, '--help'], {
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const output = await new Response(process.stdout).text();
		expect(await process.exited).toBe(0);
		expect(output).toContain(`releases ${name}`);
		expect(output).toContain('--sourceSha');
	}
	const process = Bun.spawn(['bun', 'src/cli/cli.ts', 'runs', 'approve', 'run-id'], { stdout: 'pipe', stderr: 'pipe' });
	expect(await process.exited).not.toBe(0);
	expect(await new Response(process.stderr).text()).toContain('sourceSha');
});

test('DreamCLI status reads the selected server without accepting insecure remote origins', async () => {
	const { runCommand } = await import('@kjanat/dreamcli/testkit');
	const { authStatus } = await import('@/cli/cli');
	const result = await runCommand(authStatus, [], { env: { BEEPBOOP_SERVER: 'http://remote.example' } });
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.join('')).toContain('HTTPS');
});

test('terminal login polls browser approval, persists its session, and logout revokes it', async () => {
	const { sqlite, env } = fixture();
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-login-'));
	const server = Bun.serve({
		port: 0,
		fetch: request =>
			cliAuthRoute(request, env, async request => {
				if (request.headers.get('cookie') !== 'signed-in') throw Error('browser login required');
				return 'admin';
			}),
	});
	env.APPLICATION_ORIGIN = server.url.origin;
	try {
		const client = new Client(server.url.origin, directory);
		let approval: Promise<Response> | undefined;
		await client.login((url, code) => {
			expect(new URL(url).searchParams.get('challenge')?.startsWith(code)).toBe(true);
			approval = fetch(url, { method: 'POST', headers: { cookie: 'signed-in', origin: server.url.origin } });
		}, AbortSignal.timeout(5000));
		expect((await approval)?.status).toBe(200);
		expect(await client.request('/auth/cli/status')).toEqual({ subject: 'admin' });
		await client.logout();
		expect(await readdir(directory)).toEqual([]);
		expect(sqlite.query('SELECT * FROM sessions').all()).toEqual([]);
	} finally {
		server.stop(true);
		sqlite.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test('OAuth callback returns to terminal approval without accepting arbitrary redirect targets', async () => {
	for (const cli of ['ab'.repeat(32), 'https://attacker.example']) {
		const result = await completeLogin(
			new Request('https://beepboop.test/auth/callback?state=state&code=code', {
				headers: { cookie: '__Host-beepboop_flow=flow' },
			}),
			{
				consumeFlow: async () => JSON.stringify({ state: 'state', verifier: 'verifier', cli }),
				exchange: async () => ({ access: 'access', expiresIn: 600 }),
				verify: async () => 'admin',
			},
		);
		expect(result.headers.get('Location')).toBe(
			cli.startsWith('https:') ? '/' : `/auth/cli/authorize?challenge=${cli}`,
		);
	}
});
