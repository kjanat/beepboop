import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { type TokenPermissions, tokenPermissions, workflowToken } from '#automation/token';

const audience = 'https://beepboop.example';
const ownerId = 4242;
const { privateKey, publicKey } = await generateKeyPair('RS256');
const issuerKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });

async function request(body: unknown, claims: Record<string, unknown> = {}, method = 'POST'): Promise<Request> {
	const jwt = await new SignJWT({
		repository_id: 7,
		repository: 'kjanat/example',
		repository_owner_id: ownerId,
		actor_id: ownerId,
		run_id: 11,
		run_attempt: 1,
		sha: 'a'.repeat(40),
		workflow_sha: 'b'.repeat(40),
		workflow_ref: 'kjanat/example/.github/workflows/review.yml@refs/pull/3/merge',
		ref: 'refs/pull/3/merge',
		event_name: 'pull_request',
		...claims,
	})
		.setProtectedHeader({ alg: 'RS256', kid: 'test' })
		.setIssuer('https://token.actions.githubusercontent.com')
		.setAudience(audience)
		.setSubject('repo:kjanat/example:pull_request')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);
	return new Request(`${audience}/api/workflow/token`, {
		method,
		headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
		...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
	});
}

function fakes() {
	const minted: { name: string; id: number; permissions: TokenPermissions }[] = [];
	const audited: string[][] = [];
	return {
		minted,
		audited,
		issuer: {
			token: async (name: string, id: number, permissions: TokenPermissions) => {
				minted.push({ name, id, permissions });
				return 'ghs_installation';
			},
		},
		log: {
			audit: async (actor: string, action: string, target: string) => {
				audited.push([actor, action, target]);
			},
		},
	};
}

describe('tokenPermissions', () => {
	test('keeps read and write levels', () => {
		expect(tokenPermissions({ contents: 'write', pull_requests: 'read' })).toEqual({
			contents: 'write',
			pull_requests: 'read',
		});
	});

	test('never issues permissions that reach CI configuration or secrets', () => {
		for (
			const name of [
				'workflows',
				'secrets',
				'variables',
				'environments',
				'administration',
				'dependabot_secrets',
				'actions',
				'packages',
			]
		) {
			expect(() => tokenPermissions({ contents: 'read', [name]: 'read' })).toThrow('Invalid token permission');
		}
	});

	test('refuses an empty, malformed or escalating request', () => {
		for (const raw of [{}, [], 'contents', null, { contents: 'admin' }, { 'Contents!': 'read' }, { contents: true }]) {
			expect(() => tokenPermissions(raw)).toThrow();
		}
	});
});

describe('workflowToken', () => {
	test('mints a token scoped to the calling repository for a pull_request run', async () => {
		const { minted, audited, issuer, log } = fakes();
		const response = await workflowToken(
			await request({ permissions: { contents: 'write', pull_requests: 'write' } }),
			audience,
			ownerId,
			issuer,
			log,
			issuerKeys,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ token: 'ghs_installation' });
		expect(minted).toEqual([
			{ name: 'kjanat/example', id: 7, permissions: { contents: 'write', pull_requests: 'write' } },
		]);
		expect(audited).toEqual([['run:11', 'token.issued', 'kjanat/example contents:write,pull_requests:write']]);
	});

	test('refuses a repository owned by someone else before minting', async () => {
		const { minted, issuer, log } = fakes();
		await expect(
			workflowToken(
				await request({ permissions: { contents: 'read' } }, { repository_owner_id: 1 }),
				audience,
				ownerId,
				issuer,
				log,
				issuerKeys,
			),
		).rejects.toThrow('Workflow identity is not eligible');
		expect(minted).toEqual([]);
	});

	test('refuses a run started by anyone but the owner before minting', async () => {
		for (const actor_id of [49699333, 29139614, 1]) {
			const { minted, issuer, log } = fakes();
			await expect(
				workflowToken(
					await request({ permissions: { contents: 'read' } }, { actor_id }),
					audience,
					ownerId,
					issuer,
					log,
					issuerKeys,
				),
			).rejects.toThrow('Workflow run was not started by the owner');
			expect(minted).toEqual([]);
		}
	});

	test('refuses invalid permissions before minting', async () => {
		const { minted, issuer, log } = fakes();
		await expect(
			workflowToken(await request({ permissions: { contents: 'admin' } }), audience, ownerId, issuer, log, issuerKeys),
		).rejects.toThrow('Invalid token permission');
		expect(minted).toEqual([]);
	});

	test('answers anything but POST with 405', async () => {
		const { minted, issuer, log } = fakes();
		const response = await workflowToken(await request(null, {}, 'GET'), audience, ownerId, issuer, log, issuerKeys);
		expect(response.status).toBe(405);
		expect(minted).toEqual([]);
	});
});

test('the token Action client reports why Beepboop refused', () => {
	const work = mkdtempSync(join(tmpdir(), 'token-refused-'));
	try {
		const preload = join(work, 'fetch.ts');
		writeFileSync(
			preload,
			`globalThis.fetch = async (input) => {
	const url = String(input);
	if (url.startsWith('https://oidc.example/')) return Response.json({ value: 'oidc-jwt' });
	return Response.json({ error: 'Workflow run was not started by the owner' }, { status: 400 });
};
`,
		);
		const result = spawnSync(process.execPath, ['--preload', preload, resolve('actions/runtime/client.mjs'), 'token'], {
			encoding: 'utf8',
			env: {
				...process.env,
				SERVICE_ORIGIN: 'https://beepboop.example',
				ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
				ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
				GITHUB_OUTPUT: join(work, 'github_output'),
			},
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Beepboop request failed: HTTP 400: Workflow run was not started by the owner');
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test('the token Action client requests a token and writes it masked', () => {
	const work = mkdtempSync(join(tmpdir(), 'token-action-'));
	try {
		const preload = join(work, 'fetch.ts'),
			requests = join(work, 'requests.jsonl'),
			outputs = join(work, 'github_output');
		writeFileSync(outputs, '');
		writeFileSync(
			preload,
			`import { appendFileSync } from 'node:fs';
globalThis.fetch = async (input, init) => {
	const url = String(input);
	const headers = new Headers(init?.headers);
	appendFileSync(${
				JSON.stringify(requests)
			}, JSON.stringify({ url, authorization: headers.get('authorization'), body: init?.body ?? null }) + '\\n');
	if (url.startsWith('https://oidc.example/')) return Response.json({ value: 'oidc-jwt' });
	if (url === 'https://beepboop.example/api/workflow/token') return Response.json({ token: 'ghs_installation' });
	return new Response('unexpected', { status: 500 });
};
`,
		);
		const result = spawnSync(
			process.execPath,
			['--preload', preload, resolve('actions/runtime/client.mjs'), 'token'],
			{
				encoding: 'utf8',
				env: {
					...process.env,
					SERVICE_ORIGIN: 'https://beepboop.example',
					ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token?api-version=2.0',
					ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
					PERMISSIONS: '{"contents":"write","pull_requests":"write"}',
					GITHUB_OUTPUT: outputs,
				},
			},
		);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('::add-mask::ghs_installation');
		expect(readFileSync(outputs, 'utf8')).toMatch(/^token<<value_[\w-]+\nghs_installation\nvalue_[\w-]+\n$/);
		const sent = readFileSync(requests, 'utf8').trim().split('\n').map(line => JSON.parse(line));
		expect(sent[0].url).toBe('https://oidc.example/token?api-version=2.0&audience=https%3A%2F%2Fbeepboop.example');
		expect(sent[1]).toEqual({
			url: 'https://beepboop.example/api/workflow/token',
			authorization: 'Bearer oidc-jwt',
			body: '{"permissions":{"contents":"write","pull_requests":"write"}}',
		});
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
