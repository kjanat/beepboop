import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import { readDistributionArtifact } from '@/automation/distribution-artifact';
import { RepositoryGateway } from '@/automation/github';

const repository = 'octo/widget';
const sourceSha = 'a'.repeat(40);
const runSha = 'b'.repeat(40);
const identity: WorkflowIdentity = {
	repositoryId: 1,
	repository,
	ownerId: 1,
	actorId: 1,
	runId: 123,
	attempt: 2,
	sha: runSha,
	workflowSha: runSha,
	workflowRef: `${repository}/.github/workflows/publish.yml@refs/heads/main`,
	ref: 'refs/heads/main',
	event: 'workflow_dispatch',
};
const mainPath = 'dist/main.mjs';
const postPath = 'dist/post.mjs';
const paths = [mainPath, postPath];
const main = Buffer.from([0, 0xff, 0xfe, 0x61]);
const post = Buffer.from('export const saved = true;\n');
const entries = { 'dist/main.mjs': main, 'dist/post.mjs': post, 'attestation.json': Buffer.from('{}\n') };
const workflowRun = { id: 123, repository_id: 1, head_sha: runSha };

class TokenGateway extends RepositoryGateway {
	override token() {
		return Effect.succeed('synthetic');
	}
}

function zip(files: Record<string, Uint8Array>, executables: string[] = []): Buffer {
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-distribution-artifact-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(directory, path)), { recursive: true });
			writeFileSync(join(directory, path), content);
			if (executables.includes(path)) chmodSync(join(directory, path), 0o755);
		}
		const result = spawnSync('zip', ['-q', '-r', '-', '.'], { cwd: directory });
		if (result.status !== 0) throw new Error(`Could not create ZIP fixture: ${result.stderr.toString()}`);
		return result.stdout;
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

const archive = zip(entries);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const signedUrl = 'https://artifact-storage.example/distribution.zip?signature=synthetic';

function fixture(options: {
	archive?: Uint8Array;
	download?: Uint8Array | ReadableStream<Uint8Array>;
	metadata?: Partial<{
		id: number;
		digest: string;
		expired: boolean;
		size_in_bytes: number;
		created_at: string;
		workflow_run: typeof workflowRun;
	}>;
	startedAt?: string;
	currentAttempt?: number;
	location?: string;
	redirectStatus?: number;
	sourceBytes?: Uint8Array;
} = {}) {
	const bytes = options.archive ?? archive;
	const hash = digest(bytes);
	const calls: { url: string; authorization: string | null; redirect: RequestRedirect | undefined }[] = [];
	const gateway = new TokenGateway(
		{ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' },
		1,
		async (input, init) => {
			const url = new URL(String(input));
			calls.push({
				url: url.href,
				authorization: new Headers(init?.headers).get('authorization'),
				redirect: init?.redirect,
			});
			if (url.href === signedUrl) {
				const body = options.download ?? bytes;
				return new Response(body instanceof ReadableStream ? body : new Uint8Array(body));
			}
			if (url.pathname === `/repos/${repository}/actions/artifacts/456/zip`) {
				return new Response(null, {
					status: options.redirectStatus ?? 302,
					headers: { location: options.location ?? signedUrl },
				});
			}
			if (url.pathname === `/repos/${repository}/actions/artifacts/456`) {
				return Response.json({
					id: 456,
					digest: `sha256:${hash}`,
					expired: false,
					size_in_bytes: bytes.byteLength,
					created_at: '2026-11-17T12:01:00Z',
					workflow_run: workflowRun,
					...options.metadata,
				});
			}
			if (url.pathname === `/repos/${repository}/actions/runs/123/attempts/2`) {
				return Response.json({ run_started_at: options.startedAt ?? '2026-11-17T12:00:00Z' });
			}
			if (url.pathname === `/repos/${repository}/actions/runs/123`) {
				return Response.json({ run_attempt: options.currentAttempt ?? identity.attempt });
			}
			if (url.pathname.includes('/contents/')) {
				expect(url.searchParams.get('ref')).toBe(sourceSha);
				if (options.sourceBytes) return Response.json({ sha: 'c'.repeat(40), type: 'file' });
				return new Response(null, { status: 404 });
			}
			if (url.pathname === `/repos/${repository}/git/blobs/${'c'.repeat(40)}`) {
				return Response.json({
					encoding: 'base64',
					content: Buffer.from(options.sourceBytes ?? []).toString('base64'),
				});
			}
			throw new Error(`Unexpected artifact request: ${url.href}`);
		},
	);
	return {
		gateway,
		calls,
		run: () => Effect.runPromise(readDistributionArtifact(gateway, {
			artifact: { id: 456, digest: hash },
			identity,
			sourceSha,
			paths,
		})),
	};
}

test('distribution artifacts preserve uploaded bytes and read the authorized source through Git blobs', async () => {
	const before = Buffer.from([0, 0xff, 0x62]);
	const scenario = fixture({ sourceBytes: before });
	expect(await scenario.run()).toEqual([
		{
			path: mainPath,
			before: before.toString('base64'),
			after: main.toString('base64'),
			encoding: 'base64',
			mode: '100644',
		},
		{
			path: postPath,
			before: before.toString('base64'),
			after: post.toString('base64'),
			encoding: 'base64',
			mode: '100644',
		},
	]);
	expect(scenario.calls.find(call => call.url.endsWith('/456/zip'))).toEqual({
		url: `https://api.github.com/repos/${repository}/actions/artifacts/456/zip`,
		authorization: 'Bearer synthetic',
		redirect: 'manual',
	});
	expect(scenario.calls.find(call => call.url === signedUrl)).toEqual({
		url: signedUrl,
		authorization: null,
		redirect: 'error',
	});
});

test('new distribution files use empty reviewed source bytes', async () => {
	expect((await fixture().run()).map(file => file.before)).toEqual(['', '']);
});

test('distribution artifacts preserve executable file modes from the uploaded ZIP', async () => {
	const result = await fixture({ archive: zip(entries, [mainPath]) }).run();
	expect(result.map(file => ({ path: file.path, mode: file.mode }))).toEqual([
		{ path: mainPath, mode: '100755' },
		{ path: postPath, mode: '100644' },
	]);
});

test('distribution artifacts reject another repository, run, commit, or digest before downloading', async () => {
	for (const metadata of [
		{ workflow_run: { ...workflowRun, repository_id: 2 } },
		{ workflow_run: { ...workflowRun, id: 124 } },
		{ workflow_run: { ...workflowRun, head_sha: sourceSha } },
		{ digest: `sha256:${'0'.repeat(64)}` },
		{ expired: true },
		{ size_in_bytes: 8 * 1024 * 1024 + 1 },
	]) {
		const scenario = fixture({ metadata });
		await expect(scenario.run()).rejects.toThrow('does not belong to this workflow run and digest');
		expect(scenario.calls).toHaveLength(1);
	}
});

test('distribution artifacts reject uploads from an earlier workflow attempt', async () => {
	const scenario = fixture({ startedAt: '2026-11-17T12:02:00Z' });
	await expect(scenario.run()).rejects.toThrow('predates this workflow attempt');
	expect(scenario.calls.some(call => call.url === signedUrl)).toBe(false);
});

test('distribution artifacts reject a superseded attempt before downloading newer bytes', async () => {
	const scenario = fixture({
		currentAttempt: 3,
		metadata: { created_at: '2026-11-17T12:03:00Z' },
	});
	await expect(scenario.run()).rejects.toThrow('belongs to a different workflow attempt');
	expect(scenario.calls.some(call => call.url.endsWith('/456/zip') || call.url === signedUrl)).toBe(false);
});

test('distribution artifacts verify downloaded bytes independently of GitHub metadata', async () => {
	await expect(fixture({ download: Buffer.from('tampered') }).run()).rejects.toThrow('artifact digest mismatch');
});

test('distribution artifacts reject unconfigured files and require every configured file', async () => {
	await expect(fixture({ archive: zip({ ...entries, 'README.md': Buffer.from('unexpected') }) }).run())
		.rejects.toThrow('contains unconfigured files');
	await expect(fixture({ archive: zip({ 'dist/post.mjs': post }) }).run())
		.rejects.toThrow('missing dist/main.mjs');
});

test('distribution downloads reject insecure redirect destinations without sending the token', async () => {
	for (
		const location of ['http://artifact-storage.example/file', 'https://user:password@artifact-storage.example/file']
	) {
		const scenario = fixture({ location });
		await expect(scenario.run()).rejects.toThrow('Invalid distribution artifact download URL');
		expect(scenario.calls.some(call => call.url === signedUrl)).toBe(false);
	}
	await expect(fixture({ redirectStatus: 200 }).run()).rejects.toThrow(
		'did not provide a distribution artifact download URL',
	);
});

test('distribution downloads stop and cancel the response stream at the size limit', async () => {
	let cancelled = false;
	let sent = false;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			controller.enqueue(new Uint8Array(sent ? 1 : 8 * 1024 * 1024));
			sent = true;
		},
		cancel() {
			cancelled = true;
		},
	});
	const scenario = fixture({ download: stream });
	await expect(Effect.runPromise(scenario.gateway.downloadWorkflowArtifact(repository, 456, 'synthetic')))
		.rejects.toThrow('exceeds 8 MiB');
	expect(cancelled).toBe(true);
});
