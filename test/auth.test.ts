import { describe, expect, test } from 'bun:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { workflowIdentity } from '@/automation/auth';

const audience = 'https://beepboop.example';
const ownerId = 4242;
const { privateKey, publicKey } = await generateKeyPair('RS256');
const issuerKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }] });

async function request(claims: Record<string, unknown>): Promise<Request> {
	const token = await new SignJWT({
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
	return new Request('https://beepboop.example/api/workflow/begin', {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
	});
}

describe('workflowIdentity', () => {
	test('accepts a pull_request run from an owned repository', async () => {
		const identity = await workflowIdentity(await request({}), audience, ownerId, issuerKeys);
		expect(identity.event).toBe('pull_request');
		expect(identity.ref).toBe('refs/pull/3/merge');
		expect(identity.repositoryId).toBe(7);
	});

	test('accepts a push run', async () => {
		const identity = await workflowIdentity(
			await request({ event_name: 'push', ref: 'refs/heads/main' }),
			audience,
			ownerId,
			issuerKeys,
		);
		expect(identity.event).toBe('push');
	});

	test('refuses pull_request_target', async () => {
		await expect(
			workflowIdentity(await request({ event_name: 'pull_request_target' }), audience, ownerId, issuerKeys),
		).rejects.toThrow('Workflow identity is not eligible');
	});

	test('refuses a repository owned by someone else', async () => {
		await expect(
			workflowIdentity(await request({ repository_owner_id: 1 }), audience, ownerId, issuerKeys),
		).rejects.toThrow('Workflow identity is not eligible');
	});

	test('refuses a token signed by another key', async () => {
		const other = await generateKeyPair('RS256');
		const otherKeys = createLocalJWKSet({
			keys: [{ ...(await exportJWK(other.publicKey)), kid: 'test', alg: 'RS256' }],
		});
		await expect(workflowIdentity(await request({}), audience, ownerId, otherKeys)).rejects.toThrow();
	});
});
