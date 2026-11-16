import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRefs } from '@root/actions/runtime/refs.ts';
import { gitOutput, materialize } from '@root/test/support/actions.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import { signingKey } from '@root/test/support/signing.ts';
import { Effect, Result } from 'effect';
import type { DistributionEvidence, RefChange, RefPlan } from '@/automation/refs';
import { tagObject, tagPayload } from '@/automation/refs';

let key: SigningKey;
beforeAll(() => {
	key = signingKey('Release Maintainer <release@example.com>');
});
afterAll(() => key.dispose());

function signedCommit(dir: string, tree: string, parents: string[], signed = true): string {
	const args = [
		'commit-tree',
		...(signed ? [`-S${key.fingerprint}`] : []),
		tree,
		...parents.flatMap(parent => ['-p', parent]),
		'-m',
		'Distribution fixture',
	];
	const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GNUPGHOME: key.home } });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout.trim();
}

function exists(dir: string, ref: string): boolean {
	return spawnSync('git', ['rev-parse', '--verify', ref], { cwd: dir, encoding: 'utf8' }).status === 0;
}

function fixture(options: {
	distributionParents?: 'wrong';
	ancestryParents?: 'reversed';
	ancestryTree?: 'distribution';
	unsigned?: 'distribution' | 'ancestry';
} = {}) {
	const checkout = materialize({
		'.gitignore': 'dist/\n',
		'.github/workflows/ci.yml': 'name: Test source\non: push\njobs: {}\n',
		'action.yml': 'name: Test action\nruns: {using: node24, main: dist/main.mjs, post: dist/post.mjs}\n',
		'README.md': 'Source checkout\n',
		'src/main.ts': 'export const source = true;\n',
	});
	const origin = mkdtempSync(join(tmpdir(), 'beepboop-distribution-origin-'));
	gitOutput(checkout.dir, ['branch', '-m', 'master']);
	gitOutput(checkout.dir, ['config', 'user.name', 'Release Maintainer']);
	gitOutput(checkout.dir, ['config', 'user.email', 'release@example.com']);
	gitOutput(origin, ['init', '--bare', '-q']);
	gitOutput(origin, ['config', 'core.hooksPath', join(origin, 'hooks')]);
	const sourceSha = checkout.sha;
	const sourceTree = gitOutput(checkout.dir, ['rev-parse', `${sourceSha}^{tree}`]);
	const wrongParent = signedCommit(checkout.dir, sourceTree, []);
	mkdirSync(join(checkout.dir, 'dist'));
	writeFileSync(join(checkout.dir, 'dist/main.mjs'), 'export const bundled = true;\n');
	writeFileSync(join(checkout.dir, 'dist/post.mjs'), 'export const saved = true;\n');
	gitOutput(checkout.dir, ['add', '-f', '--', 'dist/main.mjs', 'dist/post.mjs']);
	const tree = gitOutput(checkout.dir, ['write-tree']);
	gitOutput(checkout.dir, ['read-tree', sourceSha]);
	const commit = signedCommit(
		checkout.dir,
		tree,
		[options.distributionParents ? wrongParent : sourceSha],
		options.unsigned !== 'distribution',
	);
	const ancestryCommit = signedCommit(
		checkout.dir,
		options.ancestryTree ? tree : sourceTree,
		options.ancestryParents ? [commit, sourceSha] : [sourceSha, commit],
		options.unsigned !== 'ancestry',
	);
	gitOutput(checkout.dir, ['push', '-q', origin, `${sourceSha}:refs/heads/master`]);
	// GitHub's Git database API creates these objects without publishing a ref.
	gitOutput(origin, ['fetch', '-q', '--no-tags', checkout.dir, ancestryCommit]);
	const distribution: DistributionEvidence = {
		sourceSha,
		commit,
		tree,
		ancestryCommit,
		branch: 'master',
		expected: sourceSha,
	};
	const change: RefChange = { name: 'v1.2.3', expected: null, commit, annotated: true, signed: true };
	const payload = tagPayload(change, 'Release 1.2.3', `${key.uid} 1700000000 +0000`);
	const plan: RefPlan = {
		repository: 'octo/widget',
		executionId: 'release-fixture',
		version: '1.2.3',
		publicKey: key.publicKey,
		distribution,
		changes: [
			{ ...change, object: tagObject(change, '1.2.3', `${key.uid} 1700000000 +0000`, key.sign(payload)) },
			{ name: 'v1', expected: null, commit, annotated: false, signed: false },
			{ name: 'v1.2', expected: null, commit, annotated: false, signed: false },
		],
	};
	return {
		checkout,
		origin,
		sourceTree,
		plan,
		publish: () => Effect.runPromise(publishRefs(plan, checkout.dir, origin).pipe(Effect.result)),
		dispose: () => {
			rmSync(checkout.dir, { recursive: true, force: true });
			rmSync(origin, { recursive: true, force: true });
		},
	};
}

test('Git publication atomically records signed distribution ancestry while keeping master source-only', async () => {
	const scenario = fixture();
	try {
		const result = await scenario.publish();
		expect(Result.isSuccess(result)).toBe(true);
		const proof = scenario.plan.distribution;
		if (!proof) throw new Error('Missing distribution evidence');
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(proof.ancestryCommit);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master^{tree}'])).toBe(scenario.sourceTree);
		expect(gitOutput(scenario.origin, ['show', '-s', '--format=%P', 'refs/heads/master'])).toBe(
			`${proof.sourceSha} ${proof.commit}`,
		);
		expect(gitOutput(scenario.origin, ['merge-base', '--is-ancestor', proof.commit, 'refs/heads/master'])).toBe('');
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/tags/v1.2.3^{commit}'])).toBe(proof.commit);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/tags/v1'])).toBe(proof.commit);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/tags/v1.2'])).toBe(proof.commit);
		expect(key.verifies(scenario.origin, 'refs/tags/v1.2.3')).toBe(true);
		expect(gitOutput(scenario.origin, ['ls-tree', '-r', '--name-only', 'refs/heads/master'])).not.toContain('dist/');
		expect(gitOutput(scenario.origin, ['show', `${proof.commit}:.github/workflows/ci.yml`])).toBe(
			'name: Test source\non: push\njobs: {}',
		);
	} finally {
		scenario.dispose();
	}
});

test('aliases fetch their inherited distribution target in a fresh shallow source-only checkout', async () => {
	const scenario = fixture();
	const shallow = mkdtempSync(join(tmpdir(), 'beepboop-alias-shallow-'));
	try {
		expect(Result.isSuccess(await scenario.publish())).toBe(true);
		for (const name of ['v1', 'v1.2']) gitOutput(scenario.origin, ['update-ref', '-d', `refs/tags/${name}`]);
		gitOutput(shallow, ['clone', '-q', '--depth=1', '--no-tags', '--branch=master', `file://${scenario.origin}`, '.']);
		const target = scenario.plan.changes[0]?.commit;
		if (!target) throw new Error('Missing target');
		expect(exists(shallow, `${target}^{commit}`)).toBe(false);
		const { distribution: _proof, ...plan } = scenario.plan;
		plan.changes = plan.changes.filter(change => !change.annotated);
		const result = await Effect.runPromise(publishRefs(plan, shallow, scenario.origin).pipe(Effect.result));
		expect(Result.isSuccess(result)).toBe(true);
		for (const name of ['v1', 'v1.2']) {
			expect(gitOutput(scenario.origin, ['rev-parse', `refs/tags/${name}`])).toBe(target);
		}
	} finally {
		rmSync(shallow, { recursive: true, force: true });
		scenario.dispose();
	}
});

test('retry after the atomic push is idempotent, including after master advances', async () => {
	const scenario = fixture();
	try {
		expect(Result.isSuccess(await scenario.publish())).toBe(true);
		const published = gitOutput(scenario.origin, ['show-ref']);
		expect(Result.isSuccess(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['show-ref'])).toBe(published);
		const proof = scenario.plan.distribution;
		if (!proof) throw new Error('Missing distribution evidence');
		const later = signedCommit(scenario.checkout.dir, scenario.sourceTree, [proof.ancestryCommit]);
		gitOutput(scenario.checkout.dir, ['push', '-q', scenario.origin, `${later}:refs/heads/master`]);
		expect(Result.isSuccess(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(later);
	} finally {
		scenario.dispose();
	}
});

test('a changed source lease preserves master and refuses all version refs', async () => {
	const scenario = fixture();
	try {
		const newer = signedCommit(scenario.checkout.dir, scenario.sourceTree, [scenario.checkout.sha]);
		gitOutput(scenario.checkout.dir, ['push', '-q', scenario.origin, `${newer}:refs/heads/master`]);
		expect(Result.isFailure(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(newer);
		for (const ref of ['v1', 'v1.2', 'v1.2.3']) expect(exists(scenario.origin, `refs/tags/${ref}`)).toBe(false);
	} finally {
		scenario.dispose();
	}
});

test('a remote tag rejection keeps the ancestry merge and every tag unpublished', async () => {
	const scenario = fixture();
	try {
		writeFileSync(
			join(scenario.origin, 'hooks/pre-receive'),
			'#!/bin/sh\nwhile read -r old new ref; do\n  if [ "$ref" = refs/tags/v1.2.3 ]; then exit 1; fi\ndone\n',
			{ mode: 0o755 },
		);
		expect(Result.isFailure(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(scenario.checkout.sha);
		for (const ref of ['v1', 'v1.2', 'v1.2.3']) expect(exists(scenario.origin, `refs/tags/${ref}`)).toBe(false);
	} finally {
		scenario.dispose();
	}
});

for (
	const options of [
		{ distributionParents: 'wrong' },
		{ ancestryParents: 'reversed' },
		{ ancestryTree: 'distribution' },
		{ unsigned: 'distribution' },
		{ unsigned: 'ancestry' },
	] as const
) {
	test(`real Git refuses a distribution whose proof or signature is invalid: ${JSON.stringify(options)}`, async () => {
		const scenario = fixture(options);
		try {
			expect(Result.isFailure(await scenario.publish())).toBe(true);
			expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(scenario.checkout.sha);
			expect(exists(scenario.origin, 'refs/tags/v1.2.3')).toBe(false);
		} finally {
			scenario.dispose();
		}
	});
}

test('real Git rejects the wrong distribution tree in the frozen plan', async () => {
	const scenario = fixture();
	try {
		if (!scenario.plan.distribution) throw new Error('Missing distribution evidence');
		scenario.plan.distribution.tree = scenario.sourceTree;
		expect(Result.isFailure(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(scenario.checkout.sha);
		expect(exists(scenario.origin, 'refs/tags/v1.2.3')).toBe(false);
	} finally {
		scenario.dispose();
	}
});

test('version refs must target the exact signed distribution whose ancestry is being published', async () => {
	const scenario = fixture();
	try {
		const change = scenario.plan.changes[0];
		if (!change) throw new Error('Missing version ref');
		const redirected = { ...change, commit: scenario.checkout.sha };
		const payload = tagPayload(redirected, 'Release 1.2.3', `${key.uid} 1700000000 +0000`);
		scenario.plan.changes[0] = {
			...redirected,
			object: tagObject(redirected, '1.2.3', `${key.uid} 1700000000 +0000`, key.sign(payload)),
		};
		expect(Result.isFailure(await scenario.publish())).toBe(true);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(scenario.checkout.sha);
		expect(exists(scenario.origin, 'refs/tags/v1.2.3')).toBe(false);
	} finally {
		scenario.dispose();
	}
});

test('a successful push reporting a protection bypass refuses completion after the accepted write', async () => {
	const scenario = fixture();
	try {
		writeFileSync(
			join(scenario.origin, 'hooks/pre-receive'),
			"#!/bin/sh\nprintf '%s\\n' 'Bypassed rule violations for refs/heads/master' >&2\nexit 0\n",
			{ mode: 0o755 },
		);
		const result = await scenario.publish();
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) expect(result.failure.message).toContain('bypass');
		const proof = scenario.plan.distribution;
		if (!proof) throw new Error('Missing distribution evidence');
		// Preserve the accepted receipt: refusal cannot undo a server-accepted push.
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/heads/master'])).toBe(proof.ancestryCommit);
		expect(gitOutput(scenario.origin, ['rev-parse', 'refs/tags/v1.2.3^{commit}'])).toBe(proof.commit);
	} finally {
		scenario.dispose();
	}
});
