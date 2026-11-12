import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { discover, planRelease } from '@/automation/managers';
import { npmManager } from '@/automation/managers/npm';
import { buildSnapshot } from '@/automation/snapshot';
import type { Snapshot } from '@/automation/types';

function snapshot(versionSource?: unknown): Snapshot {
	const files = {
		'Cargo.toml': '[workspace]\nmembers = ["crates/tool"]\n[workspace.package]\nversion = "9.0.0"\n',
		'crates/tool/Cargo.toml': '[package]\nname = "tool"\nversion = "1.2.3"\n',
		'distribution/npm/targets.json': JSON.stringify({
			scope: '@example',
			versionSource,
			facades: [{ name: '@example/tool', pkg: 'tool', shim: '@other/fmt' }],
			targets: [{ pkg: 'linux-x64' }, { pkg: 'freebsd-x64', experimental: true }],
		}),
	};
	return {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
}

test('generated npm packages retain the workspace version default', () => {
	const inventory = npmManager.discover(snapshot());
	expect(inventory.diagnostics).toEqual([]);
	expect(inventory.packages).toHaveLength(4);
	expect(inventory.packages.every(pkg => pkg.version === '9.0.0')).toBe(true);
});

test('generated npm packages share the selected crate version through discovery and version planning', async () => {
	const original = snapshot('crates/tool/Cargo.toml#package.version');
	const built = await Effect.runPromise(buildSnapshot({
		repository: original.repository,
		sha: original.sha,
		entries: original.paths.map(path => ({ path, type: 'blob', mode: '100644' })),
		read: path => Effect.succeed(original.files[path] ?? null),
		tags: () => Effect.succeed([]),
	}));
	const inventory = discover(built);
	const npm = inventory.packages.filter(pkg => pkg.manager === 'npm');
	expect(npm.map(pkg => pkg.name)).toEqual([
		'@example/tool-linux-x64',
		'@example/tool-freebsd-x64',
		'@example/tool',
		'@other/fmt',
	]);
	expect(npm.every(pkg => pkg.version === '1.2.3' && pkg.generated)).toBe(true);
	expect(npm.find(pkg => pkg.name === '@example/tool-freebsd-x64')?.optional).toBe(true);
	expect(npm.find(pkg => pkg.name === '@other/fmt')?.dependencies).toEqual(['@example/tool']);
	const planned = await Effect.runPromise(planRelease(built, inventory, { version: '1.2.4' }));
	expect(planned.edits.map(edit => edit.path)).toEqual(['crates/tool/Cargo.toml']);
	expect(planned.edits[0]?.after).toContain('version = "1.2.4"');
});

test('invalid or missing generated npm version sources produce a diagnostic instead of invented packages', () => {
	for (
		const source of [
			'../Cargo.toml#package.version',
			'/Cargo.toml#package.version',
			'crates/missing/Cargo.toml#package.version',
			'Cargo.toml#package.version',
			'Cargo.toml#workspace.package',
			42,
		]
	) {
		const inventory = npmManager.discover(snapshot(source));
		expect(inventory.packages).toEqual([]);
		expect(inventory.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['invalid-manifest']);
	}
});
