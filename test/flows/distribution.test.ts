import { expect, test } from 'bun:test';
import { Effect, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import type { DistributionFile } from '@/automation/distribution';
import { createDistribution, readDistributionFile, readDistributionMode } from '@/automation/distribution';
import { RepositoryGateway } from '@/automation/gateway.ts';
import type { Edit } from '@/domain/inventory.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

const repository = 'octo/widget';
const sourceSha = 'a'.repeat(40), sourceTree = 'b'.repeat(40), distributionTree = 'c'.repeat(40);
const distributionCommit = 'd'.repeat(40), ancestryCommit = 'e'.repeat(40), other = 'f'.repeat(40);
const identity = { name: 'Release Maintainer', email: 'release@example.com', date: '2023-11-14T22:13:20Z' };
const files: Edit[] = [
	{ path: 'dist/main.mjs', before: '', after: 'export const installed = true;\n' },
	{ path: 'dist/post.mjs', before: '', after: 'export const saved = true;\n' },
];
const userSchema = mutableStruct({ name: Schema.String, email: Schema.String, date: Schema.String });
const commitRequestSchema = mutableStruct({
	message: Schema.String,
	tree: Schema.String,
	parents: mutableArray(Schema.String),
	author: userSchema,
	committer: userSchema,
	signature: Schema.String,
});
const treeRequestSchema = mutableStruct({
	base_tree: Schema.String,
	tree: mutableArray(
		mutableStruct({
			path: Schema.String,
			type: Schema.String,
			mode: Schema.String,
			content: Schema.optional(Schema.String),
			sha: Schema.optional(Schema.String),
		}),
	),
});

class TokenGateway extends RepositoryGateway {
	override token() {
		return Effect.succeed('synthetic');
	}
}

function fixture(options: {
	stale?: boolean;
	race?: boolean;
	unverified?: 'distribution' | 'ancestry';
	wrongTree?: boolean;
	wrongParents?: boolean;
	sourceFiles?: Record<string, string>;
	sourceBytes?: string;
} = {}) {
	const calls: { path: string; method: string }[] = [];
	const commits: Schema.Schema.Type<typeof commitRequestSchema>[] = [];
	const trees: Schema.Schema.Type<typeof treeRequestSchema>[] = [];
	const blobs: unknown[] = [];
	const signatures: { payload: string; caller: string }[] = [];
	let headReads = 0;
	const gateway = new TokenGateway(
		{ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' },
		1,
		async (input, init) => {
			const url = new URL(String(input));
			const path = url.pathname;
			const method = init?.method ?? 'GET';
			calls.push({ path, method });
			if (path === `/repos/${repository}`) {
				return Response.json({
					id: 1,
					full_name: repository,
					owner: { id: 1 },
					default_branch: 'main',
					private: false,
				});
			}
			if (path.endsWith('/git/ref/heads/main')) {
				headReads++;
				return Response.json({
					object: { type: 'commit', sha: options.stale || options.race && headReads > 1 ? other : sourceSha },
				});
			}
			if (path.endsWith(`/git/commits/${sourceSha}`)) {
				return Response.json({
					tree: { sha: sourceTree },
					parents: [{ sha: other }],
					verification: { verified: true },
				});
			}
			if (path.includes('/contents/')) {
				expect(url.searchParams.get('ref')).toBe(sourceSha);
				if (options.sourceBytes !== undefined) return Response.json({ sha: other, type: 'file' });
				const source = options.sourceFiles?.[path.split('/contents/')[1] ?? ''];
				return source === undefined
					? new Response(null, { status: 404 })
					: Response.json({ encoding: 'base64', content: btoa(source), size: source.length });
			}
			if (path.endsWith(`/git/blobs/${other}`)) {
				return Response.json({
					encoding: 'base64',
					content: `${options.sourceBytes?.slice(0, 4)}\n${options.sourceBytes?.slice(4)}\n`,
				});
			}
			if (path.endsWith('/git/blobs') && method === 'POST') {
				blobs.push(JSON.parse(String(init?.body)));
				return Response.json({ sha: other });
			}
			if (path.endsWith('/git/trees') && method === 'POST') {
				trees.push(decodeSync(treeRequestSchema, JSON.parse(String(init?.body))));
				return Response.json({ sha: distributionTree });
			}
			if (path.endsWith('/git/commits') && method === 'POST') {
				commits.push(decodeSync(commitRequestSchema, JSON.parse(String(init?.body))));
				return Response.json({ sha: commits.length === 1 ? distributionCommit : ancestryCommit });
			}
			if (path.endsWith(`/git/commits/${distributionCommit}`) || path.endsWith(`/git/commits/${ancestryCommit}`)) {
				const isDistribution = path.endsWith(distributionCommit);
				const saved = commits[isDistribution ? 0 : 1];
				if (!saved) throw new Error('Commit was not created');
				return Response.json({
					tree: { sha: options.wrongTree ? other : saved.tree },
					parents: (options.wrongParents ? [other] : saved.parents).map(sha => ({ sha })),
					verification: { verified: options.unverified !== (isDistribution ? 'distribution' : 'ancestry') },
				});
			}
			throw new Error(`Unexpected ${method} ${path}`);
		},
	);
	const signer = {
		identity: async () => ({ publicKey: 'synthetic-public-key', userId: 'Release Maintainer <release@example.com>' }),
		sign: async (payload: string, caller: string) => {
			signatures.push({ payload, caller });
			return `signature-${signatures.length}`;
		},
	};
	const run = (input: DistributionFile[] = files, paths = files.map(file => file.path)) =>
		Effect.runPromise(
			Effect.gen(function*() {
				yield* TestClock.setTime(1_700_000_000_000);
				return yield* createDistribution(gateway, {
					repository,
					repositoryId: 1,
					sourceSha,
					version: '1.2.3',
					paths,
					files: input,
					signer,
				}).pipe(Effect.result);
			}).pipe(Effect.provide(TestClock.layer())),
		);
	return { calls, commits, trees, blobs, signatures, run, gateway };
}

test('binary distributions compare source blob bytes and create base64 Git blobs without UTF-8 conversion', async () => {
	const before = btoa(String.fromCharCode(0, 255, 128, 65));
	const after = btoa(String.fromCharCode(255, 0, 254, 128, 66));
	const scenario = fixture({ sourceBytes: before });
	const result = await scenario.run(
		[{ path: 'assets/tool.wasm', before, after, encoding: 'base64', mode: '100755' }],
		['assets/tool.wasm'],
	);
	expect(Result.isSuccess(result)).toBe(true);
	expect(scenario.blobs).toEqual([{ encoding: 'base64', content: after }]);
	expect(scenario.trees).toEqual([{
		base_tree: sourceTree,
		tree: [{ path: 'assets/tool.wasm', mode: '100755', type: 'blob', sha: other }],
	}]);
	expect(
		await Effect.runPromise(
			readDistributionFile(scenario.gateway, repository, 'assets/tool.wasm', sourceSha, 'base64', 'synthetic'),
		),
	).toBe(before);
});

test('binary distributions reject malformed, noncanonical and empty bytes before any GitHub access', async () => {
	for (const after of ['', '???', 'YQ', 'YR==', 'YQ==\n']) {
		const scenario = fixture();
		const result = await scenario.run([{ path: 'asset.bin', before: '', after, encoding: 'base64' }], ['asset.bin']);
		expect(Result.isFailure(result)).toBe(true);
		expect(scenario.calls).toEqual([]);
	}
	const scenario = fixture();
	const result = await scenario.run(
		[{ path: 'asset.bin', before: 'YR==', after: 'YQ==', encoding: 'base64' }],
		['asset.bin'],
	);
	expect(Result.isFailure(result)).toBe(true);
	expect(scenario.calls).toEqual([]);
});

test('binary distribution source mismatches fail before creating blobs or commits', async () => {
	const scenario = fixture({ sourceBytes: btoa(String.fromCharCode(255, 0, 128)) });
	const result = await scenario.run(
		[{ path: 'asset.bin', before: btoa(String.fromCharCode(254, 0, 128)), after: 'YQ==', encoding: 'base64' }],
		['asset.bin'],
	);
	expect(Result.isFailure(result) && result.failure.message).toContain('Distribution source file changed');
	expect(scenario.calls.some(call => call.method !== 'GET')).toBe(false);
});

test('distribution mode reads traverse exact Git subtrees and preserve executable regular files', async () => {
	const seen: string[] = [];
	const gateway = new TokenGateway({ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' }, 1, async input => {
		const path = new URL(String(input)).pathname;
		seen.push(path);
		return Response.json({
			tree: path.endsWith(sourceSha)
				? [{ path: 'dist', mode: '040000', sha: sourceTree }]
				: [{ path: 'tool binary', mode: '100755', sha: other }],
		});
	});
	expect(await Effect.runPromise(readDistributionMode(gateway, repository, 'dist/tool binary', sourceSha, 'synthetic')))
		.toBe('100755');
	expect(seen).toEqual([`/repos/${repository}/git/trees/${sourceSha}`, `/repos/${repository}/git/trees/${sourceTree}`]);
});

test('distribution overlays the full reviewed tree and signs an ours ancestry commit without publishing refs', async () => {
	const scenario = fixture();
	const result = await scenario.run();
	expect(Result.isSuccess(result)).toBe(true);
	if (!Result.isSuccess(result)) return;
	expect(result.success).toEqual({
		sourceSha,
		commit: distributionCommit,
		tree: distributionTree,
		ancestryCommit,
		branch: 'main',
		expected: sourceSha,
	});
	expect(scenario.trees).toEqual([{
		base_tree: sourceTree,
		tree: files.map(file => ({ path: file.path, mode: '100644', type: 'blob', content: file.after })),
	}]);
	expect(scenario.commits.map(commit => ({ tree: commit.tree, parents: commit.parents }))).toEqual([
		{ tree: distributionTree, parents: [sourceSha] },
		{ tree: sourceTree, parents: [sourceSha, distributionCommit] },
	]);
	for (const [index, commit] of scenario.commits.entries()) {
		expect(commit.author).toEqual(identity);
		expect(commit.committer).toEqual(identity);
		expect(commit.signature).toBe(`signature-${index + 1}`);
		expect(scenario.signatures[index]).toEqual({
			payload: `tree ${commit.tree}\n${
				commit.parents.map(parent => `parent ${parent}\n`).join('')
			}author Release Maintainer <release@example.com> 1700000000 +0000\ncommitter Release Maintainer <release@example.com> 1700000000 +0000\n\n${commit.message}`,
			caller: `beepboop:${repository}`,
		});
	}
	expect(scenario.calls.filter(call => call.method !== 'GET').map(call => call.path)).toEqual([
		`/repos/${repository}/git/trees`,
		`/repos/${repository}/git/commits`,
		`/repos/${repository}/git/commits`,
	]);
});

test('distribution refuses a stale default branch before creating Git objects', async () => {
	const scenario = fixture({ stale: true });
	const result = await scenario.run();
	expect(Result.isFailure(result) && result.failure.message).toContain('Default branch changed');
	expect(scenario.trees).toHaveLength(0);
	expect(scenario.commits).toHaveLength(0);
});

test('distribution refuses a default branch race after signing without updating a ref', async () => {
	const scenario = fixture({ race: true });
	const result = await scenario.run();
	expect(Result.isFailure(result) && result.failure.message).toContain('Default branch changed');
	expect(scenario.commits).toHaveLength(2);
	expect(scenario.calls.some(call => call.method !== 'GET' && call.path.includes('/git/refs'))).toBe(false);
});

for (
	const path of [
		'../main.mjs',
		'/dist/main.mjs',
		'.git/config',
		'.github',
		'.github/workflows',
		'.github/workflows/publish.yml',
		'dist\\main.mjs',
	]
) {
	test(`distribution rejects unauthorized path ${path}`, async () => {
		const scenario = fixture();
		const result = await scenario.run([{ path, before: '', after: 'payload' }], [path]);
		expect(Result.isFailure(result)).toBe(true);
		expect(scenario.calls).toHaveLength(0);
	});
}

test('distribution requires the exact whitelist once and forbids missing, extra, duplicate, and deleted files', async () => {
	for (const input of [
		files.slice(1),
		[...files, { path: 'README.md', before: '', after: 'changed' }],
		[files[0], files[0]].filter((file): file is Edit => file !== undefined),
		files.map(file => ({ ...file, after: '' })),
	]) {
		const scenario = fixture();
		const result = await scenario.run(input);
		expect(Result.isFailure(result)).toBe(true);
		expect(scenario.calls).toHaveLength(0);
	}
});

test('distribution rejects edits whose before text differs from the reviewed source', async () => {
	const scenario = fixture({ sourceFiles: { 'dist/main.mjs': 'reviewed original' } });
	const result = await scenario.run();
	expect(Result.isFailure(result) && result.failure.message).toContain('Distribution source file changed');
	expect(scenario.trees).toHaveLength(0);
});

for (const unverified of ['distribution', 'ancestry'] as const) {
	test(`distribution rejects an unverified ${unverified} commit signature`, async () => {
		const scenario = fixture({ unverified });
		const result = await scenario.run();
		expect(Result.isFailure(result) && result.failure.message).toContain(
			'GitHub did not verify distribution signature',
		);
		expect(scenario.commits).toHaveLength(unverified === 'distribution' ? 1 : 2);
	});
}

for (const options of [{ wrongTree: true }, { wrongParents: true }]) {
	test(`distribution rejects GitHub commit tree or parents that differ from the signed payload ${JSON.stringify(options)}`, async () => {
		const scenario = fixture(options);
		const result = await scenario.run();
		expect(Result.isFailure(result) && result.failure.message).toContain('differs from the signed tree or parents');
	});
}
