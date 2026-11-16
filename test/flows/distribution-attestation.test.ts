import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { bundleFromJSON, bundleToJSON } from '@sigstore/bundle';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { Effect } from 'effect';
import { signedDistributionFixture } from '@root/test/support/distribution-attestation';
import { DistributionAttestationRoots, verifyDistributionAttestation } from '@/automation/distribution-attestation';
import { canonicalDistributionManifest } from '@/contract/distribution';

type Fixture = Awaited<ReturnType<typeof signedDistributionFixture>>;
function verify(fixture: Fixture) {
	return Effect.runPromise(
		verifyDistributionAttestation(fixture.request).pipe(
			Effect.provideService(DistributionAttestationRoots, [fixture.root]),
		),
	);
}

for (const privateInstance of [false, true]) {
	test(`verifies real ${privateInstance ? 'GitHub private TSA' : 'public SCT and transparency log'} signatures for the attested manifest`, async () => {
		const fixture = await signedDistributionFixture({ privateInstance });
		const result = await verify(fixture);
		expect(result.manifestSha256).toHaveLength(64);
		expect(result.bundleSha256).toHaveLength(64);
		expect(result.runId).toBe(123);
		expect(result.workflowRef).toBe(fixture.request.identity.workflowRef);
		await expect(Effect.runPromise(verifyDistributionAttestation(fixture.request))).rejects.toThrow('not trusted');
	});
}

test('rejects a tampered DSSE signature', async () => {
	const fixture = await signedDistributionFixture();
	const bundle = bundleFromJSON(fixture.request.bundle);
	if (bundle.content.$case !== 'dsseEnvelope') throw new Error('Expected DSSE fixture');
	const signature = bundle.content.dsseEnvelope.signatures[0];
	if (!signature) throw new Error('Expected DSSE signature');
	signature.sig[0] = (signature.sig[0] ?? 0) ^ 1;
	fixture.request.bundle = bundleToJSON(bundle);
	await expect(verify(fixture)).rejects.toThrow('not trusted');
});

test('rejects trusted signatures whose manifest metadata or artifact digest changed', async () => {
	const fixture = await signedDistributionFixture();
	const file = fixture.request.manifest.files[0];
	if (!file) throw new Error('Expected file');
	file.blobSha = '9'.repeat(40);
	fixture.request.manifestText = canonicalDistributionManifest(fixture.request.manifest);
	await expect(verify(fixture)).rejects.toThrow('does not cover');
});

const certificateCases: [string, string][] = [
	['8', 'https://issuer.attacker.test'],
	['9', 'https://github.com/octo/action/.github/workflows/publish.yml.evil@refs/heads/main'],
	['10', '1'.repeat(40)],
	['12', 'https://github.com/octo/another-repository'],
	['13', '1'.repeat(40)],
	['14', 'refs/heads/MAIN'],
	['15', '999'],
	['17', '999'],
	['21', 'https://github.com/octo/action/actions/runs/123/attempts/2'],
];
for (const [oid, value] of certificateCases) {
	test(`rejects a cryptographically valid attestation with wrong certificate identity ${oid}`, async () => {
		const fixture = await signedDistributionFixture({ extensions: { [oid]: value } });
		await expect(verify(fixture)).rejects.toThrow();
	});
}

test('requires both the attested manifest and exact full-path artifact subjects', async () => {
	for (const subjects of [[], [{ name: 'main.mjs', digest: { sha256: 'f'.repeat(64) } }]]) {
		const fixture = await signedDistributionFixture({ subjects });
		await expect(verify(fixture)).rejects.toThrow('subjects differ');
	}
});

test('requires authenticated run identity even when the bundle signature is valid', async () => {
	const fixture = await signedDistributionFixture();
	fixture.request.identity = { ...fixture.request.identity, attempt: 2 };
	await expect(verify(fixture)).rejects.toThrow('authenticated workflow');
});

test('requires the production public transparency proof and private signed timestamp thresholds', async () => {
	for (const privateInstance of [false, true]) {
		const fixture = await signedDistributionFixture({ privateInstance });
		const bundle = bundleFromJSON(fixture.request.bundle);
		bundle.verificationMaterial.tlogEntries = [];
		bundle.verificationMaterial.timestampVerificationData = { rfc3161Timestamps: [] };
		fixture.request.bundle = bundleToJSON(bundle);
		await expect(verify(fixture)).rejects.toThrow('not trusted');
	}
});

test('verifies real public and private attestations inside workerd and rejects unknown production roots', async () => {
	const cases = [];
	for (const privateInstance of [false, true]) {
		const fixture = await signedDistributionFixture({ privateInstance });
		const body = JSON.stringify({ request: fixture.request, root: TrustedRoot.toJSON(fixture.root) });
		cases.push({ body, production: false }, { body, production: true });
	}
	const child = Bun.spawn([
		'node',
		'--experimental-strip-types',
		join(import.meta.dir, '../support/attestation-runtime.ts'),
	], {
		stdin: new Blob([JSON.stringify({ script: join(import.meta.dir, '../fixtures/distribution-attestation/worker.ts'), cases })]),
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect(code, stderr).toBe(0);
	const responses: unknown = JSON.parse(stdout);
	expect(responses, stderr).toEqual([
		{ status: 200, body: expect.objectContaining({ manifestSha256: expect.any(String) }) },
		{ status: 422, body: { error: expect.stringContaining('not trusted') } },
		{ status: 200, body: expect.objectContaining({ manifestSha256: expect.any(String) }) },
		{ status: 422, body: { error: expect.stringContaining('not trusted') } },
	]);
}, 15_000);
