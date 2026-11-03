import { expect, test } from 'bun:test';
import { PackageURL } from 'packageurl-js';
import { packageUrl } from '@/server/package-url';

test('package labels use canonical ecosystem purls, including scoped names and Go module paths', () => {
	expect(packageUrl({ manager: 'npm', name: '@kjanat/changelog-feed', version: '1.2.3' })).toBe(
		'pkg:npm/%40kjanat/changelog-feed@1.2.3',
	);
	expect(packageUrl({ manager: 'npm', name: 'changelog-feed' })).toBe('pkg:npm/changelog-feed');
	expect(packageUrl({ manager: 'cargo', name: 'some-crate', version: '0.1.0' })).toBe('pkg:cargo/some-crate@0.1.0');
	expect(packageUrl({ manager: 'go', name: 'actionlint.kjanat.dev/v2', version: 'v2.0.0' })).toBe(
		'pkg:golang/actionlint.kjanat.dev/v2@v2.0.0',
	);
});

test('non-registry managers use generic purls and package components are escaped', () => {
	const value = packageUrl({ manager: 'goreleaser', name: 'release tool', version: '1.0.0+build' });
	const parsed = PackageURL.fromString(value);
	expect(parsed.type).toBe('generic');
	expect(parsed.namespace).toBe('goreleaser');
	expect(parsed.name).toBe('release tool');
	expect(parsed.version).toBe('1.0.0+build');
	expect(parsed.subpath).toBeUndefined();
});
