import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRefs } from '@root/actions/runtime/refs.ts';
import { commitAll, gitOutput, materialize } from '@root/test/support/actions.ts';
import { Effect, Exit, Schema } from 'effect';
import { packageId } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';
import type { RefPolicy } from '@/automation/refs';
import { moduleTagPrefixes, planRefs, versionTagged } from '@/automation/refs';
import type { Package } from '@/automation/types';
import { semVer } from '@/contract/version';

const commit = 'a'.repeat(40), other = 'b'.repeat(40), oid = 'c'.repeat(40);
const policy: RefPolicy = { phase: 'version', prefix: 'rshellcheck-v', aliases: [], signed: false };
const goModule: Package = {
	manager: 'go',
	name: 'github.com/octo/shellcheck/go',
	manifest: 'go/go.mod',
	versionSource: 'tags:go/v',
	publication: registry,
	dependencies: [],
};
const rootModule: Package = {
	...goModule,
	name: 'github.com/octo/shellcheck',
	manifest: 'go.mod',
	versionSource: 'tags:v',
};
const crate: Package = {
	manager: 'cargo',
	name: 'rshellcheck',
	version: '1.0.0',
	manifest: 'Cargo.toml',
	versionSource: 'manifest:Cargo.toml',
	publication: registry,
	dependencies: [],
};

test('module tag prefixes come from the Go modules a stream names', () => {
	const packages = [goModule, rootModule, crate];
	expect(moduleTagPrefixes(packages, [packageId(goModule), packageId(crate)])).toEqual(['go/v']);
	expect(moduleTagPrefixes(packages, [packageId(crate)])).toEqual([]);
	expect(moduleTagPrefixes(packages, [])).toEqual([]);
});

test('a version ref plan tags each named Go module next to the version tag', async () => {
	const changes = await Effect.runPromise(planRefs(policy, '1.1.0', commit, [], ['go/v', 'rshellcheck-v']));
	expect(changes).toEqual([
		{ name: 'rshellcheck-v1.1.0', expected: null, commit, annotated: true, signed: false },
		{ name: 'go/v1.1.0', expected: null, commit, annotated: true, signed: false },
	]);
});

test('a version ref plan keeps a module tag that already names the release commit', async () => {
	const changes = await Effect.runPromise(
		planRefs(policy, '1.1.0', commit, [{ name: 'go/v1.1.0', oid, commit }], ['go/v']),
	);
	expect(changes[1]).toEqual({ name: 'go/v1.1.0', expected: oid, commit, annotated: true, signed: false });
});

test('a version ref plan refuses a module tag on another commit', async () => {
	const exit = await Effect.runPromiseExit(
		planRefs(policy, '1.1.0', commit, [{ name: 'go/v1.1.0', oid, commit: other }], ['go/v']),
	);
	expect(Exit.isFailure(exit)).toBe(true);
	expect(JSON.stringify(exit)).toContain(`Version tag go/v1.1.0 already targets ${other.slice(0, 12)}`);
});

test('a release is version-tagged only when every version tag names its commit', () => {
	const version = Schema.decodeSync(semVer)('1.1.0');
	const tags = [{ name: 'rshellcheck-v1.1.0', oid, commit }, { name: 'go/v1.1.0', oid, commit }];
	expect(versionTagged(policy, version, commit, tags, ['go/v'])).toBe(true);
	expect(versionTagged(policy, version, commit, tags.slice(0, 1), ['go/v'])).toBe(false);
	expect(versionTagged(policy, version, other, tags)).toBe(false);
	expect(versionTagged({ ...policy, phase: 'aliases' }, version, commit, tags)).toBe(false);
});

function moving() {
	const checkout = materialize({ 'README.md': 'one\n' });
	const origin = mkdtempSync(join(tmpdir(), 'beepboop-origin-'));
	gitOutput(origin, ['init', '--bare', '-q']);
	gitOutput(checkout.dir, ['tag', '-a', '-m', 'Release 1.0.0', 'v1.0.0', checkout.sha]);
	gitOutput(checkout.dir, ['push', '-q', origin, 'refs/tags/v1.0.0']);
	const old = gitOutput(origin, ['rev-parse', 'refs/tags/v1.0.0']);
	writeFileSync(join(checkout.dir, 'README.md'), 'two\n');
	const fixed = commitAll(checkout.dir, 'Fix');
	const plan = (expected: string) => ({
		repository: 'octo/widget',
		executionId: 'e',
		version: '1.0.0',
		changes: [{ name: 'v1.0.0', expected, commit: fixed, annotated: true, signed: false, replaces: true }],
	});
	const dispose = () => {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(origin, { recursive: true, force: true });
	};
	return { checkout, origin, old, fixed, plan, dispose };
}

test('a replacing ref plan moves the version tag to the new release commit under a lease', async () => {
	const { checkout, origin, old, fixed, plan, dispose } = moving();
	try {
		await Effect.runPromise(publishRefs(plan(old), checkout.dir, origin));
		expect(gitOutput(origin, ['rev-parse', 'refs/tags/v1.0.0^{commit}'])).toBe(fixed);
		expect(gitOutput(origin, ['cat-file', '-t', 'refs/tags/v1.0.0'])).toBe('tag');
	} finally {
		dispose();
	}
});

test('a replacing ref plan leaves a tag alone that moved since the plan', async () => {
	const { checkout, origin, old, plan, dispose } = moving();
	try {
		const exit = await Effect.runPromiseExit(publishRefs(plan('d'.repeat(40)), checkout.dir, origin));
		expect(Exit.isFailure(exit)).toBe(true);
		expect(gitOutput(origin, ['rev-parse', 'refs/tags/v1.0.0'])).toBe(old);
	} finally {
		dispose();
	}
});

test('a version ref plan replaces a tag on another commit that the release reclaims', async () => {
	const tag = { name: 'v1.1.0', oid, commit: other };
	expect(await Effect.runPromise(planRefs({ ...policy, prefix: 'v' }, '1.1.0', commit, [tag], [], [tag]))).toEqual([
		{ name: 'v1.1.0', expected: oid, commit, annotated: true, signed: false, replaces: true },
	]);
	const moved = { ...tag, oid: 'e'.repeat(40) };
	const exit = await Effect.runPromiseExit(planRefs({ ...policy, prefix: 'v' }, '1.1.0', commit, [moved], [], [tag]));
	expect(JSON.stringify(exit)).toContain(`Version tag v1.1.0 already targets ${other.slice(0, 12)}`);
});
