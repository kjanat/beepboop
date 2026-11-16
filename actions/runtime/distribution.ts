import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Environment, Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, fail, required } from '@root/actions/runtime/protocol.ts';
import { post } from '@root/actions/runtime/session.ts';
import { Effect } from 'effect';
import { repositoryNamePattern } from '@/automation/repository-name.ts';
import type { DistributionManifest } from '@/contract/distribution.ts';
import {
	canonicalDistributionManifest,
	distributionManifestName,
	parseDistributionManifest,
	safeDistributionPath,
} from '@/contract/distribution.ts';
import { githubApiVersion } from '@/contract/http.ts';
import { shaPattern } from '@/contract/ids.ts';
import { array, record, text } from '@/model.ts';
import { responseJson } from '@/runtime/http.ts';
import { writeOutputTo } from '@/tooling/github-output.ts';

function snapshot(root: string, path: string): { bytes: Buffer; mode: '100644' | '100755' } {
	const parts = path.split('/');
	for (let index = 1; index < parts.length; index++) {
		if (!lstatSync(join(root, ...parts.slice(0, index))).isDirectory()) {
			throw new Error('Distribution directories must be regular directories');
		}
	}
	if (!lstatSync(join(root, path)).isFile()) throw new Error('Distribution paths must be regular files');
	const descriptor = openSync(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(descriptor);
		if (!before.isFile()) throw new Error('Distribution paths must be regular files');
		const bytes = readFileSync(descriptor);
		const after = fstatSync(descriptor);
		if (
			!bytes.length || bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
			|| before.ctimeMs !== after.ctimeMs
		) {
			throw new Error('Distribution file is empty or changed while reading');
		}
		return { bytes, mode: before.mode & 0o111 ? '100755' : '100644' };
	} finally {
		closeSync(descriptor);
	}
}

export function prepareDistribution(
	environment: Environment,
	send: typeof post = post,
): Effect.Effect<{ manifestPath: string; subjectChecksums: string }, Invalid> {
	return Effect.gen(function*() {
		const root = yield* Effect.fromResult(required(environment, 'GITHUB_WORKSPACE'));
		const token = yield* Effect.fromResult(required(environment, 'DISTRIBUTION_TOKEN'));
		const input = yield* Effect.fromResult(
			record(yield* Effect.fromResult(attempt((): unknown => JSON.parse(environment.CONTEXT || '{}')))),
		);
		const contextFile = input.contextFile;
		const context = typeof contextFile === 'string'
			? yield* Effect.fromResult(
				record(yield* Effect.fromResult(attempt((): unknown => JSON.parse(readFileSync(contextFile, 'utf8'))))),
			)
			: input;
		const executionId = yield* Effect.fromResult(text(context.id));
		const sourceSha = yield* Effect.fromResult(text(context.sourceSha));
		const repository = yield* Effect.fromResult(text(context.repository));
		const repositoryId = context.repositoryId;
		if (
			!Number.isSafeInteger(repositoryId) || typeof repositoryId !== 'number' || repositoryId <= 0
			|| !repositoryNamePattern.test(repository) || !/^[a-f0-9]{64}$/.test(executionId)
		) return yield* fail('Invalid distribution repository identity');
		const workflowSha = yield* Effect.fromResult(required(environment, 'GITHUB_WORKFLOW_SHA'));
		const workflowRef = yield* Effect.fromResult(required(environment, 'GITHUB_WORKFLOW_REF'));
		const runSha = yield* Effect.fromResult(required(environment, 'GITHUB_SHA'));
		const runId = Number(yield* Effect.fromResult(required(environment, 'GITHUB_RUN_ID')));
		const runAttempt = Number(yield* Effect.fromResult(required(environment, 'GITHUB_RUN_ATTEMPT')));
		if (
			![sourceSha, workflowSha, runSha].every(value => shaPattern.test(value))
			|| ![runId, runAttempt].every(value => Number.isSafeInteger(value) && value > 0)
		) return yield* fail('Invalid distribution workflow identity');
		if (environment.GITHUB_REPOSITORY !== repository || !workflowRef.startsWith(`${repository}/.github/workflows/`)) {
			return yield* fail('Distribution workflow repository differs from the execution');
		}
		const head = yield* Effect.fromResult(
			attempt(() => spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' })),
		);
		if (head.status !== 0 || head.stdout.trim() !== sourceSha) {
			return yield* fail('Distribution checkout differs from the reviewed source');
		}
		const paths = yield* Effect.fromResult(
			array(yield* Effect.fromResult(attempt((): unknown => JSON.parse(environment.DISTRIBUTION_PATHS || '[]')))),
		);
		const names: string[] = [];
		for (const entry of paths) {
			const path = yield* Effect.fromResult(text(entry));
			if (!safeDistributionPath(path) || /[\r\n]/.test(path) || names.includes(path)) {
				return yield* fail('Invalid or duplicate distribution path');
			}
			names.push(path);
		}
		if (
			!names.length || names.length > 1023 || names.includes(distributionManifestName(executionId))
			|| names.some(path => names.some(other => path !== other && path.startsWith(`${other}/`)))
		) {
			return yield* fail('Distribution requires unique exact nonoverlapping files');
		}
		const files: DistributionManifest['files'] = [];
		for (const path of names.sort()) {
			const { bytes, mode } = yield* Effect.fromResult(attempt(() => snapshot(root, path)));
			const sha256 = createHash('sha256').update(bytes).digest('hex');
			const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
			const response = yield* send(`https://api.github.com/repos/${repository}/git/blobs`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': githubApiVersion,
				},
				body: JSON.stringify({ encoding: 'base64', content: bytes.toString('base64') }),
				signal: AbortSignal.timeout(60000),
			});
			if (!response.ok) {
				yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
				return yield* fail(`GitHub rejected distribution blob upload (HTTP ${response.status})`);
			}
			const uploaded = yield* responseJson(response).pipe(
				Effect.mapError(() => new ActionFailure({ message: 'Invalid GitHub blob upload response' })),
			);
			const result = yield* Effect.fromResult(record(uploaded));
			if (result.sha !== blobSha) return yield* fail('GitHub blob differs from the captured distribution bytes');
			files.push({ path, blobSha, sha256, size: bytes.length, mode });
		}
		const manifest: DistributionManifest = {
			version: 1,
			executionId,
			repositoryId,
			repository,
			sourceSha,
			workflowSha,
			workflowRef,
			runSha,
			runId,
			runAttempt,
			files,
		};
		const encoded = canonicalDistributionManifest(manifest);
		yield* Effect.fromResult(parseDistributionManifest(encoded));
		const temporary = yield* Effect.fromResult(required(environment, 'RUNNER_TEMP'));
		const directory = yield* Effect.fromResult(attempt(() => mkdtempSync(join(temporary, 'beepboop-distribution-'))));
		const manifestName = distributionManifestName(executionId);
		const manifestPath = join(directory, manifestName), subjectChecksums = join(directory, 'subjects.sha256');
		const digest = createHash('sha256').update(encoded).digest('hex');
		yield* Effect.fromResult(attempt(() => {
			writeFileSync(manifestPath, encoded, { mode: 0o600 });
			writeFileSync(
				subjectChecksums,
				[...files.map(file => `${file.sha256}  ${file.path}`), `${digest}  ${manifestName}`, ''].join('\n'),
				{ mode: 0o600 },
			);
		}));
		return { manifestPath, subjectChecksums };
	});
}

if (import.meta.main) {
	await Effect.runPromise(Effect.gen(function*() {
		const output = yield* prepareDistribution(process.env);
		yield* writeOutputTo(process.env.GITHUB_OUTPUT, 'manifest-path', output.manifestPath);
		yield* writeOutputTo(process.env.GITHUB_OUTPUT, 'subject-checksums', output.subjectChecksums);
	}));
}
