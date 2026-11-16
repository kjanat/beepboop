import { expect, test } from 'bun:test';
import { signedDistributionFixture } from '@root/test/support/distribution-attestation.ts';
import { Effect, Result, Schema } from 'effect';
import { DistributionAttestationRoots } from '@/automation/distribution-attestation';
import { createDistribution } from '@/automation/distribution';
import { RepositoryGateway } from '@/automation/github';
import type { DistributionSubmission } from '@/contract/distribution';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

const sourceTree = '1'.repeat(40), distributionTree = '2'.repeat(40);
const distributionCommit = '3'.repeat(40), ancestryCommit = '4'.repeat(40), other = '5'.repeat(40);
const commitRequest = mutableStruct({
	tree: Schema.String,
	parents: mutableArray(Schema.String),
	message: Schema.String,
});
const treeRequest = mutableStruct({
	base_tree: Schema.String,
	tree: mutableArray(mutableStruct({
		path: Schema.String,
		type: Schema.String,
		mode: Schema.String,
		sha: Schema.String,
	})),
});
class TokenGateway extends RepositoryGateway {
	override token() {
		return Effect.succeed('synthetic');
	}
}
async function fixture(
	options: { stale?: boolean; race?: boolean; unverified?: boolean; wrongTree?: boolean; wrongParents?: boolean } = {},
) {
	const attested = await signedDistributionFixture();
	const { manifest, identity, manifestText, bundle } = attested.request;
	const calls: { path: string; method: string }[] = [];
	const commits: (typeof commitRequest.Type)[] = [];
	const trees: (typeof treeRequest.Type)[] = [];
	const signatures: string[] = [];
	let heads = 0;
	const gateway = new TokenGateway({ GITHUB_APP_ID: 'fixture', GITHUB_APP_PRIVATE_KEY: '' }, 1, async (input, init) => {
		const path = new URL(String(input)).pathname, method = init?.method ?? 'GET';
		calls.push({ path, method });
		if (path === `/repos/${manifest.repository}`) {
			return Response.json({
				id: manifest.repositoryId,
				full_name: manifest.repository,
				owner: { id: 2 },
				default_branch: 'main',
			});
		}
		if (path.endsWith('/git/ref/heads/main')) {
			return Response.json({
				object: { type: 'commit', sha: options.stale || options.race && ++heads > 1 ? other : manifest.sourceSha },
			});
		}
		if (path.endsWith(`/git/commits/${manifest.sourceSha}`)) {
			return Response.json({ tree: { sha: sourceTree }, parents: [], verification: { verified: true } });
		}
		if (path.endsWith('/git/trees') && method === 'POST') {
			trees.push(decodeSync(treeRequest, JSON.parse(String(init?.body))));
			return Response.json({ sha: distributionTree });
		}
		if (path.endsWith('/git/commits') && method === 'POST') {
			commits.push(decodeSync(commitRequest, JSON.parse(String(init?.body))));
			return Response.json({ sha: commits.length === 1 ? distributionCommit : ancestryCommit });
		}
		const saved = path.endsWith(distributionCommit)
			? commits[0]
			: path.endsWith(ancestryCommit)
			? commits[1]
			: undefined;
		if (saved) {
			return Response.json({
				tree: { sha: options.wrongTree ? other : saved.tree },
				parents: (options.wrongParents ? [other] : saved.parents).map(sha => ({ sha })),
				verification: { verified: !options.unverified },
			});
		}
		throw new Error(`Unexpected GitHub access ${method} ${path}`);
	});
	const run = (
		submission: DistributionSubmission = { manifest: manifestText, bundle },
		paths = manifest.files.map(file => file.path),
	) =>
		Effect.runPromise(
			createDistribution(gateway, {
				repository: manifest.repository,
				repositoryId: manifest.repositoryId,
				executionId: manifest.executionId,
				sourceSha: manifest.sourceSha,
				version: '1.2.3',
				paths,
				submission,
				identity,
				signer: {
					identity: async () => ({ publicKey: 'fixture', userId: 'Release Maintainer <release@example.com>' }),
					sign: async payload => {
						signatures.push(payload);
						return 'fixture-signature';
					},
				},
			}).pipe(Effect.provideService(DistributionAttestationRoots, [attested.root]), Effect.result),
		);
	return { attested, run, calls, trees, commits, signatures };
}

test('verified provenance authorizes only uploaded blob IDs, preserving source-only ancestry and audit evidence', async () => {
	const scenario = await fixture();
	const result = await scenario.run();
	expect(Result.isSuccess(result)).toBe(true);
	if (Result.isFailure(result)) throw result.failure;
	const { manifest } = scenario.attested.request;
	expect(scenario.trees).toEqual([{
		base_tree: sourceTree,
		tree: manifest.files.map(file => ({ path: file.path, mode: file.mode, type: 'blob', sha: file.blobSha })),
	}]);
	expect(scenario.commits.map(({ tree, parents }) => ({ tree, parents }))).toEqual([
		{ tree: distributionTree, parents: [manifest.sourceSha] },
		{ tree: sourceTree, parents: [manifest.sourceSha, distributionCommit] },
	]);
	expect(scenario.signatures).toHaveLength(2);
	expect(scenario.calls.every(call => !call.path.includes('/git/blobs') && !call.path.includes('/contents/'))).toBe(
		true,
	);
	expect(result.success.manifest).toEqual(manifest);
	expect(result.success.provenance?.bundleSha256).toMatch(/^[a-f0-9]{64}$/);
});

test('missing or invalid provenance, mismatched source, and unconfigured paths reach neither GitHub writes nor signer', async () => {
	for (const kind of ['bundle', 'source', 'path']) {
		const scenario = await fixture();
		const original = scenario.attested.request;
		const submission = { manifest: original.manifestText, bundle: kind === 'bundle' ? {} : original.bundle };
		if (kind === 'source') submission.manifest = submission.manifest.replace(original.manifest.sourceSha, other);
		const result = await scenario.run(submission, kind === 'path' ? ['another-file.mjs'] : undefined);
		expect(Result.isFailure(result)).toBe(true);
		expect(scenario.calls).toEqual([]);
		expect(scenario.signatures).toEqual([]);
	}
});

test('stale source, races, or unverified and mismatched GitHub commits cannot produce an authorized ref plan', async () => {
	for (const options of [
		{ stale: true },
		{ race: true },
		{ unverified: true },
		{ wrongTree: true },
		{ wrongParents: true },
	]) {
		const scenario = await fixture(options);
		expect(Result.isFailure(await scenario.run())).toBe(true);
		if (options.stale) expect(scenario.signatures).toEqual([]);
	}
});
