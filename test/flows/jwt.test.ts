import { expect, test } from 'bun:test';
import type { World } from '@root/test/support/world';
import { adminSubject, eachWorld, epoch, issuer, origin } from '@root/test/support/world';
import { Effect, Result } from 'effect';
import type { JWTPayload } from 'jose';
import { decodeJwt, exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { administrator, workflowIdentity } from '@/automation/auth';
import { RepositoryGateway } from '@/automation/github';
import { Automation } from '@/automation/service';

let world: World;
eachWorld(created => {
	world = created;
});

type Identity = 'administrator' | 'workflow';
type Algorithm = 'RS256' | 'ES256' | 'ES384';

async function signingKey(algorithm: Algorithm) {
	const pair = await generateKeyPair(algorithm, { extractable: true });
	return {
		privateKey: pair.privateKey,
		jwk: { ...(await exportJWK(pair.publicKey)), alg: algorithm, kid: algorithm, use: 'sig' },
	};
}
const keys = Promise.all([signingKey('RS256'), signingKey('ES256'), signingKey('ES384')]).then(
	([rsa, ec, otherCurve]) => ({ RS256: rsa, ES256: ec, ES384: otherCurve }),
);

function claims(kind: Identity): JWTPayload {
	const registered = {
		iss: kind === 'administrator' ? issuer : 'https://token.actions.githubusercontent.com',
		aud: kind === 'administrator' ? 'beepboop' : origin,
		sub: kind === 'administrator' ? adminSubject : 'repo:octo/widget:ref:refs/heads/main',
		iat: epoch / 1000,
		exp: epoch / 1000 + 600,
	};
	return kind === 'administrator'
		? { ...registered, mode: 'access', type: 'user' }
		: {
			...registered,
			repository_id: '1',
			repository: 'octo/widget',
			repository_owner_id: world.env.OWNER_ID,
			actor_id: world.env.OWNER_ID,
			run_id: '42',
			run_attempt: '1',
			sha: 'a'.repeat(40),
			workflow_sha: 'a'.repeat(40),
			workflow_ref: 'octo/widget/.github/workflows/publish.yml@refs/heads/main',
			job_workflow_ref: 'octo/widget/.github/workflows/publish.yml@refs/heads/main',
			ref: 'refs/heads/main',
			event_name: 'workflow_dispatch',
		};
}

async function token(
	kind: Identity,
	payload = claims(kind),
	algorithm: Algorithm = kind === 'administrator' ? 'ES256' : 'RS256',
) {
	const signing = await keys;
	world.network.serve(
		kind === 'administrator' ? new URL(issuer).host : 'token.actions.githubusercontent.com',
		() => Response.json({ keys: Object.values(signing).map(key => key.jwk) }),
	);
	return new SignJWT(payload).setProtectedHeader({ alg: algorithm, kid: algorithm, typ: 'application/custom+jwt' })
		.sign(signing[algorithm].privateKey);
}

function authenticate(kind: Identity, value: string) {
	return world.run(
		Effect.flatMap(Automation, service => {
			const request = new Request(origin, {
				headers: kind === 'administrator'
					? { Cookie: `__Host-beepboop_access=${value}` }
					: { Authorization: `Bearer ${value}` },
			});
			return kind === 'administrator'
				? administrator(request, world.env, service.authentication).pipe(Effect.asVoid)
				: workflowIdentity(request, origin, Number(world.env.OWNER_ID), service.authentication.workflowKeys).pipe(
					Effect.asVoid,
				);
		}).pipe(Effect.result),
	);
}

test.each(
	[
		['administrator', 'ES256'],
		['administrator', 'RS256'],
		['workflow', 'RS256'],
	] as const,
)('%s accepts independently signed %s tokens', async (kind, algorithm) => {
	expect(Result.isSuccess(await authenticate(kind, await token(kind, claims(kind), algorithm)))).toBe(true);
});

for (const kind of ['administrator', 'workflow'] as const) {
	test.each(
		[
			['wrong issuer', { iss: 'https://other.example' }],
			['wrong audience', { aud: 'other-application' }],
			['expired', { exp: epoch / 1000 }],
			['not yet valid', { nbf: epoch / 1000 + 1 }],
			['missing expiration', { exp: undefined }],
			['missing subject', { sub: undefined }],
		] as const,
	)(`${kind} rejects %s claims`, async (_name, overrides) => {
		const rejected = await authenticate(kind, await token(kind, { ...claims(kind), ...overrides }));
		expect(Result.isFailure(rejected) && rejected.failure.problem.code).toBe('unauthenticated');
	});

	test(`${kind} preserves audience arrays, unrestricted token types and future issued-at policy`, async () => {
		const accepted = claims(kind);
		accepted.aud = ['another-audience', kind === 'administrator' ? 'beepboop' : origin];
		accepted.iat = epoch / 1000 + 60;
		expect(Result.isSuccess(await authenticate(kind, await token(kind, accepted)))).toBe(true);
	});

	test(`${kind} rejects a supported but disallowed algorithm`, async () => {
		const rejected = await authenticate(kind, await token(kind, claims(kind), 'ES384'));
		expect(Result.isFailure(rejected) && rejected.failure.problem.code).toBe('unauthenticated');
	});

	test(`${kind} rejects malformed tokens and payloads altered after signing`, async () => {
		const signed = await token(kind);
		const modified = Buffer.from(JSON.stringify({ ...decodeJwt(signed), jti: 'tampered' })).toString('base64url');
		for (const value of ['not.a.jwt', signed.replace(/\.[^.]+\./, `.${modified}.`)]) {
			const rejected = await authenticate(kind, value);
			expect(Result.isFailure(rejected) && rejected.failure.problem.code).toBe('unauthenticated');
		}
	});

	test(`${kind} distinguishes malformed issuer keys from a temporary issuer outage`, async () => {
		const value = await token(kind);
		const host = kind === 'administrator' ? new URL(issuer).host : 'token.actions.githubusercontent.com';
		world.network.serve(host, () => new Response('not JSON'));
		const malformed = await authenticate(kind, value);
		expect(Result.isFailure(malformed) && malformed.failure.problem.code).toBe('unauthenticated');
		for (const respond of [
			() => new Response('Issuer unavailable', { status: 503 }),
			() => Promise.reject(new Error('Connection refused')),
		]) {
			world.network.serve(host, respond);
			const unavailable = await authenticate(kind, value);
			expect(Result.isFailure(unavailable) && unavailable.failure.problem).toEqual({
				code: 'upstream',
				service: 'oidc',
				retryable: true,
			});
		}
		await token(kind);
		expect(Result.isSuccess(await authenticate(kind, value))).toBe(true);
	});
}

test('workflow tokens still require issued-at and reject administrator signing algorithms', async () => {
	const missingIssuedAt = claims('workflow');
	delete missingIssuedAt.iat;
	for (const value of [
		await token('workflow', missingIssuedAt),
		await token('workflow', claims('workflow'), 'ES256'),
	]) {
		const rejected = await authenticate('workflow', value);
		expect(Result.isFailure(rejected) && rejected.failure.problem.code).toBe('unauthenticated');
	}
});

test('administrator tokens keep optional issued-at and enforce access mode, user type and subject', async () => {
	const withoutIssuedAt = claims('administrator');
	delete withoutIssuedAt.iat;
	expect(Result.isSuccess(await authenticate('administrator', await token('administrator', withoutIssuedAt)))).toBe(
		true,
	);
	for (
		const [overrides, code] of [
			[{ mode: 'refresh' }, 'unauthenticated'],
			[{ type: 'service' }, 'unauthenticated'],
			[{ sub: 'another-user' }, 'forbidden'],
		] as const
	) {
		const rejected = await authenticate(
			'administrator',
			await token('administrator', { ...claims('administrator'), ...overrides }),
		);
		expect(Result.isFailure(rejected) && rejected.failure.problem.code).toBe(code);
	}
});

test('GitHub App JWTs verify independently with jose and retain their issuer and validity window', async () => {
	const pair = await generateKeyPair('RS256', { extractable: true });
	const appKey = await exportPKCS8(pair.privateKey);
	const issued: JWTPayload[] = [];
	const gateway = new RepositoryGateway(
		{ ...world.env, GITHUB_APP_PRIVATE_KEY: appKey },
		Number(world.env.OWNER_ID),
		async (_input, init) => {
			const authorization = new Headers(init?.headers).get('authorization') ?? '';
			const verified = await jwtVerify(authorization.slice('Bearer '.length), pair.publicKey, {
				algorithms: ['RS256'],
				issuer: world.env.GITHUB_APP_ID,
				currentDate: new Date(epoch),
				requiredClaims: ['iss', 'iat', 'exp'],
			});
			expect(verified.protectedHeader.alg).toBe('RS256');
			issued.push(verified.payload);
			return Response.json({ slug: 'beepboop' });
		},
	);
	expect(await Effect.runPromise(gateway.appPage)).toBe('https://github.com/apps/beepboop');
	expect(issued).toHaveLength(1);
	expect(issued[0]).toMatchObject({ iss: world.env.GITHUB_APP_ID, iat: epoch / 1000 - 60, exp: epoch / 1000 + 540 });
});
