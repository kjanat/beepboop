import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { discover } from '@/automation/managers';
import { identityOf, matchesPackage, packageId, publicationIdentity, selectorKey } from '@/automation/package-identity';
import { type KnownPackageIdentity, packageIdentity, purl, purlDefinitions } from '@/package-url';
import { packageMetadata } from '@/package-url/metadata';

const native = 'pkg:jsr/%40kjanat/beepboop';
const legacy = 'pkg:generic/%40kjanat/beepboop?repository_url=https:%2F%2Fjsr.io';
const identity: KnownPackageIdentity = { type: 'jsr', namespace: '@kjanat', name: 'beepboop' };
// @ts-expect-error Every JSR identity requires a scope.
const unscoped: KnownPackageIdentity = { type: 'jsr', name: 'beepboop' };

test('JSR extension generates scoped identities and registry metadata', () => {
	expect(purl(identity)).toBe(native);
	expect(packageIdentity(`${native}@1.2.3-rc.1+build.2#src`)).toEqual({
		...identity,
		version: '1.2.3-rc.1+build.2',
		subpath: 'src',
	});
	expect(packageMetadata(native).repository).toBe('https://jsr.io/');
	const definition = purlDefinitions.get('jsr');
	assert(definition);
	for (const example of definition.examples ?? []) expect(purl(example)).toBe(example);
	expect(() => packageIdentity(unscoped)).toThrow();
});

test('JSR rejects non-registry names and non-SemVer versions', () => {
	for (const namespace of ['scope', '@Xx', '@x', '@-scope', `@${'x'.repeat(21)}`]) {
		expect(() => packageIdentity({ ...identity, namespace })).toThrow();
	}
	for (const name of ['Xx', 'x', '-tool', 'tool_name', 'a'.repeat(59)]) {
		expect(() => packageIdentity({ ...identity, name })).toThrow();
	}
	for (const version of ['v1.0.0', '1.0', '01.0.0', '1.0.0-01', 'latest']) {
		expect(() => packageIdentity({ ...identity, version })).toThrow();
	}
});

test('discovery, stored identities and versioned selectors agree on native JSR PURLs', () => {
	const inventory = discover({
		repository: { name: 'kjanat/beepboop', id: 1, defaultBranch: 'master' },
		sha: 'a'.repeat(40),
		files: { 'jsr.json': '{"name":"@kjanat/beepboop","version":"1.2.3"}' },
	});
	const pkg = inventory.packages[0];
	assert(pkg);
	expect(packageId(pkg)).toBe(native);
	const stored = { ...pkg, identity: packageIdentity(legacy) };
	expect(identityOf(stored)).toEqual(identity);
	for (const reference of [native, legacy, 'jsr:@kjanat/beepboop']) {
		expect(matchesPackage(reference, pkg)).toBe(true);
		expect(selectorKey(reference)).toBe(native);
	}
	expect(matchesPackage(legacy.replace('?', '@1.2.3?'), pkg)).toBe(true);
	expect(matchesPackage(legacy.replace('?', '@9.9.9?'), pkg)).toBe(false);
	expect(purl(publicationIdentity(stored, '2.0.0'))).toBe(`${native}@2.0.0`);
});

test('configuration upgrades old selectors without rewriting unrelated generic identities', () => {
	const config = parseRepositoryConfiguration({
		streams: {
			cli: {
				versioning: 'workspace',
				packages: [legacy],
				required: [legacy],
				promote: { workflow: { file: 'publish.yml', publications: [legacy] } },
			},
		},
	});
	expect(config.streams.cli?.packages).toEqual([native]);
	expect(config.streams.cli?.required).toEqual([native]);
	expect(config.streams.cli?.promote?.workflow?.publications).toEqual([native]);
	expect(purl(legacy)).toBe(legacy);
	const extra = `${legacy}&platform=linux#src`;
	expect(selectorKey(extra)).toBe(`${native}?platform=linux#src`);
	const custom = legacy.replace('jsr.io', 'custom.example');
	expect(selectorKey(custom)).toBe(custom);
});
