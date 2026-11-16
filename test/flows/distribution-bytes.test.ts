import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareDistribution } from '@root/actions/runtime/distribution.ts';
import { requestBody } from '@root/actions/runtime/protocol.ts';
import type { post } from '@root/actions/runtime/session.ts';
import { materialize } from '@root/test/support/actions.ts';
import { Effect, Result } from 'effect';
import { parseDistributionManifest } from '@/contract/distribution';

const executionId = 'a'.repeat(64);
function fixture() {
	const checkout = materialize({ '.gitignore': 'dist/\n', 'action.yml': 'name: Fixture\n' });
	mkdirSync(join(checkout.dir, 'dist'));
	return {
		checkout,
		environment: {
			GITHUB_WORKSPACE: checkout.dir,
			RUNNER_TEMP: checkout.dir,
			DISTRIBUTION_TOKEN: 'synthetic-token',
			CONTEXT: JSON.stringify({ id: executionId, repositoryId: 1, repository: 'octo/action', sourceSha: checkout.sha }),
			GITHUB_REPOSITORY: 'octo/action',
			GITHUB_WORKFLOW_SHA: 'b'.repeat(40),
			GITHUB_SHA: 'b'.repeat(40),
			GITHUB_WORKFLOW_REF: 'octo/action/.github/workflows/release.yml@refs/heads/main',
			GITHUB_RUN_ID: '123',
			GITHUB_RUN_ATTEMPT: '2',
			DISTRIBUTION_PATHS: '["dist/runtime tool.wasm"]',
		},
	};
}

test('large executable binary uploads directly to GitHub while ref planning sends only small proof metadata', async () => {
	const { checkout, environment } = fixture();
	const bytes = Buffer.alloc(2_200_000, 0xa5);
	writeFileSync(join(checkout.dir, 'dist/runtime tool.wasm'), bytes);
	chmodSync(join(checkout.dir, 'dist/runtime tool.wasm'), 0o755);
	const uploads: { content: string; encoding: string }[] = [];
	const send: typeof post = (input, init) => Effect.sync(() => {
		expect(String(input)).toBe('https://api.github.com/repos/octo/action/git/blobs');
		expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
		const body = JSON.parse(String(init?.body));
		uploads.push(body);
		return Response.json({
			sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(Buffer.from(body.content, 'base64')).digest(
				'hex',
			),
		});
	});
	try {
		const prepared = await Effect.runPromise(prepareDistribution(environment, send));
		expect(uploads).toHaveLength(1);
		expect(Buffer.from(uploads[0]!.content, 'base64')).toEqual(bytes);
		const manifestText = readFileSync(prepared.manifestPath, 'utf8');
		const manifest = Result.getOrThrow(parseDistributionManifest(manifestText));
		expect(manifest.files[0]).toMatchObject({
			path: 'dist/runtime tool.wasm',
			mode: '100755',
			size: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		});
		expect(manifest).toMatchObject({
			executionId,
			sourceSha: checkout.sha,
			workflowSha: environment.GITHUB_WORKFLOW_SHA,
			runSha: environment.GITHUB_SHA,
			runId: 123,
			runAttempt: 2,
		});
		expect(readFileSync(prepared.subjectChecksums, 'utf8')).toContain(
			`${manifest.files[0]!.sha256}  dist/runtime tool.wasm\n`,
		);
		const bundlePath = join(checkout.dir, 'bundle.json');
		writeFileSync(
			bundlePath,
			JSON.stringify({ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', dsseEnvelope: {} }),
		);
		const body = Result.getOrThrow(
			requestBody('refs-plan', {
				EXECUTION_ID: executionId,
				DISTRIBUTION_MANIFEST: prepared.manifestPath,
				DISTRIBUTION_BUNDLE: bundlePath,
			}, 0),
		);
		expect(JSON.stringify(body).length).toBeLessThan(3000);
		expect(body).toEqual({
			executionId,
			distribution: { manifest: manifestText, bundle: JSON.parse(readFileSync(bundlePath, 'utf8')) },
		});
		expect(requestBody('refs-plan', { EXECUTION_ID: executionId }, 0)).toEqual(Result.succeed({ executionId }));
		writeFileSync(bundlePath, ' '.repeat(1_048_577));
		expect(
			Result.isFailure(
				requestBody('refs-plan', {
					EXECUTION_ID: executionId,
					DISTRIBUTION_MANIFEST: prepared.manifestPath,
					DISTRIBUTION_BUNDLE: bundlePath,
				}, 0),
			),
		).toBe(true);
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});

test('preparing distribution rejects protected paths, traversal, symlinks and a changed source checkout', async () => {
	const { checkout, environment } = fixture();
	writeFileSync(join(checkout.dir, 'asset'), 'payload');
	symlinkSync('asset', join(checkout.dir, 'link'));
	symlinkSync('.', join(checkout.dir, 'directory-link'));
	let uploads = 0;
	const send: typeof post = () =>
		Effect.sync(() => {
			uploads++;
			throw new Error('Unexpected upload');
		});
	try {
		for (const path of [
			'link',
			'directory-link/asset',
			'.',
			'../asset',
			'.git/config',
			'.github/workflows/release.yml',
			'/asset',
			'a\\b',
		]) {
			const result = await Effect.runPromise(
				prepareDistribution({ ...environment, DISTRIBUTION_PATHS: JSON.stringify([path]) }, send).pipe(Effect.result),
			);
			expect(Result.isFailure(result)).toBe(true);
		}
		const result = await Effect.runPromise(
			prepareDistribution({
				...environment,
				CONTEXT: JSON.stringify({
					id: executionId,
					sourceSha: 'c'.repeat(40),
					repository: 'octo/action',
					repositoryId: 1,
				}),
			}, send).pipe(Effect.result),
		);
		expect(Result.isFailure(result)).toBe(true);
		expect(uploads).toBe(0);
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});

test('preparing distribution refuses a GitHub blob identity that differs from the uploaded bytes', async () => {
	const { checkout, environment } = fixture();
	writeFileSync(join(checkout.dir, 'dist/runtime tool.wasm'), Buffer.from([0, 255, 128]));
	const send: typeof post = () => Effect.succeed(Response.json({ sha: 'd'.repeat(40) }));
	try {
		const result = await Effect.runPromise(prepareDistribution(environment, send).pipe(Effect.result));
		expect(Result.isFailure(result) && result.failure.message).toContain('GitHub blob differs');
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
});
