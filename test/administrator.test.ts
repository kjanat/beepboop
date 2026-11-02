import { afterAll, beforeAll, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { type AuthBindings, administrator } from '#automation/auth';

const issuer = 'https://auth.administrator.test';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'openauth', alg: 'ES256', use: 'sig' }] };
const env: Pick<AuthBindings, 'APPLICATION_ORIGIN' | 'OPENAUTH_ISSUER' | 'OPENAUTH_CLIENT_ID' | 'ADMIN_SUBJECT'> = {
	APPLICATION_ORIGIN: 'https://beepboop.example',
	OPENAUTH_ISSUER: issuer,
	OPENAUTH_CLIENT_ID: 'beepboop',
	ADMIN_SUBJECT: 'user:admin',
};
const realFetch = globalThis.fetch;
beforeAll(() => {
	globalThis.fetch = Object.assign(
		async (input: string | URL | Request) =>
			String(input instanceof Request ? input.url : input) === `${issuer}/.well-known/jwks.json`
				? Response.json(jwks)
				: new Response('unexpected', { status: 500 }),
		{ preconnect: realFetch.preconnect },
	);
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

async function openauthAccessToken(subject: string, claims: Record<string, unknown> = {}): Promise<string> {
	return new SignJWT({
		mode: 'access',
		type: 'user',
		properties: {},
		aud: 'beepboop',
		iss: issuer,
		sub: subject,
		...claims,
	})
		.setExpirationTime(Math.floor(Date.now() / 1000) + 600)
		.setProtectedHeader({ alg: 'ES256', kid: 'openauth', typ: 'JWT' })
		.sign(privateKey);
}

function dashboard(token: string): Request {
	return new Request('https://beepboop.example/api/repositories', {
		headers: { cookie: `__Host-beepboop_access=${token}` },
	});
}

test('an OpenAuth access token without iat signs the administrator in', async () => {
	expect(await administrator(dashboard(await openauthAccessToken('user:admin')), env)).toBe('user:admin');
});

test('the administrator gate still refuses other subjects and non-access tokens', async () => {
	await expect(administrator(dashboard(await openauthAccessToken('user:someone')), env)).rejects.toThrow(
		'Administrator access denied',
	);
	await expect(administrator(dashboard(await openauthAccessToken('user:admin', { mode: 'refresh' })), env)).rejects
		.toThrow('Administrator access token required');
});
