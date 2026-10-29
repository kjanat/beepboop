import { expect, test } from 'bun:test';
import { parseRepositoryConfiguration } from '#automation/configuration';
import { dependenciesReady, validatePublicationIdentity } from '#automation/execution';
import { createManagedPreparation } from '#automation/managed';
import { discover } from '#automation/managers';
import { planReleaseSet } from '#automation/planning';
import { compileReleaseSet } from '#automation/release-set';
import type { RepositoryRecord, Snapshot } from '#automation/types';

async function fixture() {
	const snapshot: Snapshot = {
		repository: { id: 1, name: 'example/tools', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: {
			'package.json': '{"name":"cli","version":"1.0.0"}',
			'core/package.json': '{"name":"core","version":"2.0.0"}',
			'.github/workflows/release.yml':
				'on:\n  workflow_dispatch:\n    inputs:\n      beepboop_execution_id: {type: string}\njobs: {}',
		},
	};
	const configuration = parseRepositoryConfiguration({
		streams: {
			main: {
				versioning: 'independent',
				required: ['npm:cli', 'npm:core'],
				promote: { workflow: { file: 'release.yml' } },
				workflows: {
					'build-cli': { file: 'release.yml' },
					'publish-cli': { file: 'release.yml', needs: ['promote'], publications: ['npm:cli'] },
					'publish-core': { file: 'release.yml', needs: ['promote'], publications: ['npm:core'] },
				},
			},
		},
	});
	const repository: RepositoryRecord = {
		...snapshot.repository,
		sha: snapshot.sha,
		configuration,
		inventory: discover(snapshot),
		presetShas: {},
		diagnostics: [],
		updatedAt: 0,
	};
	const plan = planReleaseSet(snapshot, repository.inventory, {
		groups: [
			{ id: 'cli', packages: ['npm:cli'], version: { bump: 'patch' } },
			{ id: 'core', packages: ['npm:core'], version: { bump: 'minor' } },
		],
		operations: [
			{ id: 'promote', group: 'cli' },
			{
				id: 'build-cli',
				group: 'cli',
				platform: { os: 'linux', arch: 'arm64' },
				outputs: [{ id: 'archive', kind: 'archive' }],
			},
			{ id: 'publish-cli', group: 'cli', inputs: [{ operation: 'build-cli', output: 'archive' }] },
			{ id: 'publish-core', group: 'core' },
		],
	});
	const preparation = await createManagedPreparation(repository, 'main', plan);
	preparation.state = 'succeeded';
	if (!preparation.managed) throw new Error('Missing managed preparation');
	preparation.managed.result = { url: 'https://github.com/example/tools/pull/1', head: 'b'.repeat(40) };
	const merged = { ...snapshot, sha: 'c'.repeat(40), files: { ...snapshot.files } };
	for (const edit of plan.edits) merged.files[edit.path] = edit.after;
	return { preparation, merged };
}

test('release set compiles group versions and preserves approval and output dependencies', async () => {
	const { preparation, merged } = await fixture();
	const executions = await compileReleaseSet(preparation, merged);
	const byName = new Map(executions.map(execution => [execution.operation, execution]));
	expect(byName.get('publish-core')?.version).toBe('2.1.0');
	expect(byName.get('publish-cli')?.version).toBe('1.0.1');
	expect(byName.get('promote')?.state).toBe('blocked');
	expect(byName.get('publish-cli')?.dependencies).toEqual([
		byName.get('build-cli')?.id ?? '',
		byName.get('promote')?.id ?? '',
	]);
	expect(byName.get('publish-core')?.releaseSet?.required).toEqual(['npm:core']);
	expect(byName.get('publish-cli')?.releaseSet?.required).toEqual(['npm:cli']);
	expect(executions.every(execution => execution.sourceSha === merged.sha)).toBe(true);
	expect(executions.every(execution => execution.configurationSha === preparation.configurationSha)).toBe(true);
	expect((await compileReleaseSet(preparation, merged)).map(execution => execution.id)).toEqual(
		executions.map(execution => execution.id),
	);
});
test('release set rejects changed prepared files and omitted configured dependencies', async () => {
	const { preparation, merged } = await fixture();
	await expect(compileReleaseSet(preparation, { ...merged, files: { ...merged.files, 'package.json': '{}' } })).rejects
		.toThrow('Prepared content changed');
	const plan = preparation.managed?.plan;
	if (!plan || !('groups' in plan)) throw new Error('Missing release set');
	plan.operations = plan.operations.filter(operation => operation.id !== 'promote');
	await expect(compileReleaseSet(preparation, merged)).rejects.toThrow('omits a dependency');
});
test('combined configured and planned edges cannot introduce a cycle', async () => {
	const { preparation, merged } = await fixture();
	const plan = preparation.managed?.plan;
	if (!plan || !('groups' in plan)) throw new Error('Missing release set');
	const promote = plan.operations.find(operation => operation.id === 'promote');
	if (promote) promote.needs = ['publish-cli'];
	await expect(compileReleaseSet(preparation, merged)).rejects.toThrow('cycle');
});

test('publication evidence cannot satisfy another manager or group version', async () => {
	const { preparation, merged } = await fixture();
	const execution = (await compileReleaseSet(preparation, merged)).find(op => op.operation === 'publish-core');
	if (!execution) throw new Error('Missing publisher');
	const publication = {
		id: 'npm:core',
		manager: 'npm' as const,
		name: 'core',
		version: '2.1.0',
		required: true,
		outcome: 'succeeded' as const,
	};
	expect(() => validatePublicationIdentity(execution, publication)).not.toThrow();
	expect(() => validatePublicationIdentity(execution, { ...publication, manager: 'workflow' })).toThrow('identity');
	expect(() => validatePublicationIdentity(execution, { ...publication, version: '2.0.0' })).toThrow('version');
});

test('dependencies require success for the same source and configuration revision', async () => {
	const { preparation, merged } = await fixture();
	const executions = await compileReleaseSet(preparation, merged);
	const publisher = executions.find(op => op.operation === 'publish-core');
	if (!publisher) throw new Error('Missing publisher');
	expect(dependenciesReady(publisher, executions)).toBe(false);
	const succeeded = executions.map(execution => ({ ...execution, state: 'succeeded' as const }));
	expect(dependenciesReady(publisher, succeeded)).toBe(true);
	expect(dependenciesReady(publisher, succeeded.map(execution => ({ ...execution, sourceSha: 'f'.repeat(40) })))).toBe(
		false,
	);
});
