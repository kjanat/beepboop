import { expect, test } from 'bun:test';
import { unreleasedManifestVersion } from '@/automation/release-version';
import type { Package } from '@/automation/types';

function manifest(version = '1.2.0'): Package {
	return {
		manager: 'npm',
		name: 'widget',
		version,
		published: '1.1.0',
		publicationStatus: 'published',
		manifest: 'package.json',
		versionSource: 'package.json#version',
		publication: { kind: 'registry' },
		dependencies: [],
	};
}

function module(version: string | undefined = '1.1.0'): Package {
	return {
		...manifest(),
		manager: 'go',
		name: 'github.com/octo/widget/go',
		version,
		manifest: 'go/go.mod',
		versionSource: 'tags:go/v',
	};
}

test('the next manifest release does not require its Go version tag to exist already', () => {
	expect(unreleasedManifestVersion([manifest(), module()])).toBe('1.2.0');
	expect(
		unreleasedManifestVersion([manifest(), {
			...module(),
			version: undefined,
			published: undefined,
			publicationStatus: 'missing',
		}]),
	).toBe('1.2.0');
});

test('tag-only packages cannot infer a manifest release', () => {
	expect(unreleasedManifestVersion([{ ...module(), publicationStatus: 'missing' }])).toBeUndefined();
});

test('mixed releases still require synchronized manifests and verified registry state', () => {
	expect(unreleasedManifestVersion([manifest(), manifest('1.3.0'), module()])).toBeUndefined();
	expect(unreleasedManifestVersion([manifest(), { ...module(), publicationStatus: 'unchecked' }])).toBeUndefined();
	expect(unreleasedManifestVersion([manifest(), { ...module(), published: '1.3.0' }])).toBeUndefined();
	expect(unreleasedManifestVersion([{ ...manifest(), published: '1.2.0' }, { ...module('1.2.0'), published: '1.2.0' }]))
		.toBeUndefined();
});
