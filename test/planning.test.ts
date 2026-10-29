import { expect, test } from 'bun:test';
import { discover } from '#automation/managers';
import { planReleaseSet } from '#automation/planning';
import type { Snapshot } from '#automation/types';

const snapshot: Snapshot = {
	repository: { id: 1, name: 'example/tools', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: {
		'package.json': JSON.stringify({ name: 'cli', version: '1.0.0', dependencies: { core: '^2.0.0' } }),
		'core/package.json': JSON.stringify({ name: 'core', version: '2.0.0' }),
	},
};
const groups = [
	{ id: 'cli', packages: ['npm:cli'], version: { bump: 'patch' } },
	{ id: 'core', packages: ['npm:core'], version: { bump: 'minor' } },
];
test('independent versions compose edits and dependencies against one source revision', () => {
	const plan = planReleaseSet(snapshot, discover(snapshot), { groups });
	expect(plan.groups.map(group => group.version)).toEqual(['1.0.1', '2.1.0']);
	expect(JSON.parse(plan.edits.find(edit => edit.path === 'package.json')?.after ?? '')).toEqual({
		name: 'cli',
		version: '1.0.1',
		dependencies: { core: '^2.1.0' },
	});
	expect(plan.publicationOrder).toEqual(['npm:core', 'npm:cli']);
	expect(planReleaseSet(snapshot, discover(snapshot), { groups: [...groups].reverse() })).toEqual(plan);
});
test('platform consumers depend on all declared producer outputs', () => {
	const operations = ['x64', 'arm64'].map(arch => ({
		id: `build-${arch}`,
		group: 'cli',
		platform: { os: 'windows', arch },
		outputs: [{ id: 'zip', kind: 'archive' }],
	}));
	const plan = planReleaseSet(snapshot, discover(snapshot), {
		groups,
		operations: [...operations, {
			id: 'winget',
			group: 'cli',
			inputs: operations.map(op => ({ operation: op.id, output: 'zip' })),
			outputs: [{ id: 'manifests', kind: 'manifest' }],
		}],
	});
	expect(plan.operations.at(-1)?.needs).toEqual(['build-arm64', 'build-x64']);
	expect(plan.operations.every(op => op.version === '1.0.1')).toBe(true);
});
test('rejects ambiguous selections, unknown outputs, and cycles', () => {
	const inventory = discover(snapshot);
	expect(() => planReleaseSet(snapshot, inventory, { groups: [...groups, groups[0]] })).toThrow('Duplicate');
	expect(() => planReleaseSet(snapshot, inventory, { groups }, ['npm:cli'])).toThrow('outside');
	expect(() =>
		planReleaseSet(snapshot, inventory, {
			groups,
			operations: [{ id: 'publish', group: 'cli', inputs: [{ operation: 'missing', output: 'zip' }] }],
		})
	).toThrow('Unknown output');
	expect(() =>
		planReleaseSet(snapshot, inventory, {
			groups,
			operations: [{ id: 'publish', group: 'cli', needs: ['publish'] }],
		})
	).toThrow('cycle');
});
test('shared version sources cannot be split into independent groups', () => {
	const cargo = {
		...snapshot,
		files: {
			'Cargo.toml': '[workspace]\nmembers=["a", "b"]\n[workspace.package]\nversion="1.0.0"\n',
			'a/Cargo.toml': '[package]\nname="a"\nversion.workspace=true\n',
			'b/Cargo.toml': '[package]\nname="b"\nversion.workspace=true\n',
		},
	};
	expect(() =>
		planReleaseSet(cargo, discover(cargo), {
			groups: [{ id: 'a', packages: ['cargo:a'], version: '2.0.0' }],
		})
	).toThrow('share a version source');
});
