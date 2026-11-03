import { expect, test } from 'bun:test';
import { discover, planRelease } from '@/automation/managers';
import { emptyInventory, ManagerRegistry } from '@/automation/managers/registry';
import type { Snapshot } from '@/automation/types';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'example/tools', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: { 'Cargo.toml': 'invalid = [', 'package.json': '{"name":"tool","version":"1.0.0"}' },
};
test('disabled ecosystem parsers do not produce diagnostics', () => {
	expect(discover(snapshot, ['workflow']).diagnostics).toEqual([]);
	expect(discover(snapshot, ['npm']).diagnostics).toEqual([]);
	expect(discover(snapshot, ['cargo']).diagnostics.length).toBeGreaterThan(0);
});
test('registry delegates discovery and edits without ecosystem branches', () => {
	const registry = new ManagerRegistry([{
		name: 'manifest',
		discover: () => ({ ...emptyInventory(), managers: ['manifest'] }),
		ownsVersionSource: source => source === 'version.txt#version',
		editVersion: ({ version }) => `${version}\n`,
	}]);
	expect(registry.discover(snapshot).managers).toEqual(['manifest']);
	expect(registry.editVersion({ source: 'version.txt#version', before: '1.0.0', version: '2.0.0', packages: [] }))
		.toBe('2.0.0\n');
	expect(() => registry.editVersion({ source: 'unknown', before: '', version: '2.0.0', packages: [] }))
		.toThrow('exactly one');
	expect(() =>
		new ManagerRegistry([
			{ name: 'manifest', discover: emptyInventory },
			{ name: 'manifest', discover: emptyInventory },
		])
	).toThrow('Duplicate manager');
});
test('unregistered publication verification cannot imply success', async () => {
	const result = await new ManagerRegistry([]).verifyPublication({
		id: 'manifest:tool',
		name: 'tool',
		manager: 'manifest',
		version: '1.0.0',
		required: true,
		outcome: 'succeeded',
	}, async () => {
		throw new Error('Unexpected network request');
	});
	expect(result.outcome).toBe('uncertain');
});

test('release planner accepts an injected version manager', () => {
	const fixture = { ...snapshot, files: { 'version.txt': '1.0.0\n' } };
	const registry = new ManagerRegistry([{
		name: 'manifest',
		discover: () => ({
			...emptyInventory(),
			packages: [{
				identity: { type: 'generic', namespace: 'manifest', name: 'tool', version: '1.0.0' },
				manager: 'manifest',
				name: 'tool',
				version: '1.0.0',
				manifest: 'version.txt',
				versionSource: 'version.txt#version',
				publish: true,
				dependencies: [],
			}],
		}),
		ownsVersionSource: source => source === 'version.txt#version',
		editVersion: ({ version }) => `${version}\n`,
	}]);
	const plan = planRelease(fixture, registry.discover(fixture), { bump: 'minor' }, undefined, registry);
	expect(plan.edits).toEqual([{ path: 'version.txt', before: '1.0.0\n', after: '1.1.0\n' }]);
});

test('discovery requires an explicit identity and does not derive its type from the adapter', () => {
	const pkg = {
		manager: 'manifest' as const,
		name: 'legacy-name',
		version: '1.0.0',
		manifest: 'vcpkg.json',
		versionSource: 'vcpkg.json#version',
		publish: true,
		dependencies: [],
	};
	const adapter = { name: 'manifest' as const, discover: () => ({ ...emptyInventory(), packages: [{ ...pkg }] }) };
	expect(() => new ManagerRegistry([adapter]).discover(snapshot)).toThrow('did not identify');
	const identity = { type: 'vcpkg', name: 'zlib', version: '1.3.1', qualifiers: { triplet: 'x64-linux' } };
	const inventory = new ManagerRegistry([{ ...adapter, identity: () => identity }]).discover(snapshot);
	expect(inventory.packages[0]?.identity).toEqual(identity);
	expect(inventory.publicationOrder).toEqual(['pkg:vcpkg/zlib?triplet=x64-linux']);
});
