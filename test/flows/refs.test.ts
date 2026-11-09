import { expect, test } from 'bun:test';
import { Effect, Exit } from 'effect';
import { packageId } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';
import type { RefPolicy } from '@/automation/refs';
import { moduleTagPrefixes, planRefs } from '@/automation/refs';
import type { Package } from '@/automation/types';

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
