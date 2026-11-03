import { expect, test } from 'bun:test';
import { identityOf } from '@/automation/package-identity';
import { packageIdentity, purl, purlDefinitions } from '@/package-url';
import { typeDefinitionSchema } from '@/package-url/definition';
import definitions from '@/package-url/definitions';
import { packageMetadata } from '@/package-url/metadata';

test('the complete definition model preserves all upstream fields', () => {
	for (const definition of definitions) {
		expect(typeDefinitionSchema.parse(definition) as unknown).toEqual(definition);
		expect(purlDefinitions.get(definition.type) as unknown).toEqual(definition);
	}
});

test('repository and qualifier defaults are metadata, not identity mutations', () => {
	const source = 'pkg:vscode-extension/ms-python/python@1.2.3';
	const metadata = packageMetadata(source);
	expect(metadata.repository).toBe('https://marketplace.visualstudio.com/vscode');
	expect(metadata.qualifiers.platform).toBe('universal');
	expect(metadata.identity.qualifiers).toBeUndefined();
	expect(purl(metadata.identity)).toBe(source);
	const custom = packageMetadata(`${source}?platform=linux-x64&repository_url=https:%2F%2Fopen-vsx.org`);
	expect(custom.repository).toBe('https://open-vsx.org');
	expect(custom.qualifiers.platform).toBe('linux-x64');
});

test('an explicit identity is authoritative, independent of release adapter fields', () => {
	const identity = packageIdentity('pkg:github/owner/repo@release-2026?custom=Value#src');
	expect(identityOf({ manager: 'goreleaser', name: 'legacy-name', version: '1.0.0', identity }, 'other/repo')).toEqual(
		identity,
	);
});

test('definition model rejects missing metadata and invalid requirement values', () => {
	const npm = purlDefinitions.get('npm');
	expect(npm).toBeDefined();
	expect(() => typeDefinitionSchema.parse({ ...npm, repository: undefined })).toThrow();
	expect(() => typeDefinitionSchema.parse({ ...npm, namespace_definition: { requirement: 'maybe' } })).toThrow();
	expect(() => typeDefinitionSchema.parse({ ...npm, name_definition: { requirement: 'optional' } })).toThrow();
});

test('strict parsing applies the same qualifier rules to strings and structured inputs', () => {
	for (const key of ['Platform', '%61rch', '1arch', '__proto__']) {
		expect(() => packageIdentity(`pkg:generic/tool?${key}=linux`)).toThrow();
		expect(() => packageIdentity({ type: 'generic', name: 'tool', qualifiers: { [key]: 'linux' } })).toThrow();
	}
	expect(() => packageIdentity('pkg:generic/tool?arch=x86&arch=arm')).toThrow('Duplicate');
});

test('core syntax supports future types without inventing ecosystem semantics', () => {
	const source = 'pkg:future-ecosystem/Owner/Tool@Version?custom=Value#src';
	expect(purl(source)).toBe(source);
	const metadata = packageMetadata(source);
	expect(metadata.definition).toBeUndefined();
	expect(metadata.repository).toBeUndefined();
	expect(metadata.warnings).toEqual([{
		component: 'type',
		message: 'No registered definition for type: future-ecosystem',
	}]);
	expect(() => packageIdentity({ type: 'bad_type', name: 'tool' })).toThrow('Invalid package URL type');
});

test('explicit normalization refuses key collisions and preserves qualifier values', async () => {
	const { normalizePackage } = await import('@/package-url/normalize');
	expect(normalizePackage('pkg:generic/tool?Platform=Linux-X64').qualifiers).toEqual({ platform: 'Linux-X64' });
	expect(() => normalizePackage('pkg:generic/tool?Arch=x86&arch=arm')).toThrow('Duplicate');
	expect(() => normalizePackage({ type: 'generic', name: 'tool', qualifiers: { Arch: 'x86', arch: 'arm' } })).toThrow(
		'Duplicate',
	);
});

test('an explicit publication version update preserves registry, platform and subpath', async () => {
	const { publicationIdentity } = await import('@/automation/package-identity');
	const identity = packageIdentity('pkg:npm/tool@1.0.0?repository_url=https:%2F%2Fregistry.example#lib');
	expect(publicationIdentity({ manager: 'npm', name: 'tool', identity }, '2.0.0')).toEqual({
		...identity,
		version: '2.0.0',
	});
});

test('qualifier values survive URI encoding without form decoding or whitespace loss', () => {
	const identity = { type: 'generic', name: 'tool', qualifiers: { custom: ' +100% ' } };
	expect(packageIdentity(purl(identity))).toEqual(identity);
	expect(packageIdentity('pkg:generic/tool?custom=a+b').qualifiers).toEqual({ custom: 'a+b' });
	expect(() => packageIdentity('pkg:generic/tool?custom=%invalid')).toThrow();
});

test('textual name normalization follows the ecosystem while preserving case-sensitive names', () => {
	expect(purl({ type: 'pub', name: 'My.Package-Name', version: '1.0' })).toBe('pkg:pub/my_package_name@1.0');
	expect(purl({ type: 'hackage', name: 'AC_HalfInteger', version: '1.2.1' })).toBe('pkg:hackage/AC-HalfInteger@1.2.1');
	expect(purl('pkg:hackage/AC-HalfInteger@1.2.1')).toBe('pkg:hackage/AC-HalfInteger@1.2.1');
});

for (const definition of purlDefinitions.values()) {
	test(`${definition.type}: every definition example preserves its components through serialization`, () => {
		for (const example of definition.examples) {
			const identity = packageIdentity(example);
			expect(packageIdentity(purl(identity))).toEqual(identity);
		}
	});
}
