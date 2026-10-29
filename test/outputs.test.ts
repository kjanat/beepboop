import { expect, test } from 'bun:test';
import { parseRepositoryConfiguration } from '#automation/configuration';
import { completion, createExecution } from '#automation/execution';
import { mergeArtifacts, resolveInputs } from '#automation/outputs';
import type { Artifact, RepositoryRecord } from '#automation/types';

const configuration = {
	streams: {
		main: {
			workflows: {
				build: {
					file: 'build.yml',
					platform: { os: 'windows', arch: 'arm64' },
					outputs: [{ id: 'zip', kind: 'archive' }],
				},
				winget: { file: 'winget.yml', artifactInputs: [{ operation: 'build', output: 'zip' }] },
			},
		},
	},
};
const artifact: Artifact = {
	id: 10,
	runId: 20,
	name: 'zip',
	digest: `sha256:${'a'.repeat(64)}`,
	expiresAt: '2099-01-01T00:00:00Z',
};
async function fixture() {
	const repository: RepositoryRecord = {
		id: 1,
		name: 'example/tool',
		defaultBranch: 'main',
		sha: 'a'.repeat(40),
		configuration: parseRepositoryConfiguration(configuration),
		presetShas: {},
		diagnostics: [],
		updatedAt: 0,
		inventory: {
			packages: [],
			managers: [],
			diagnostics: [],
			publicationOrder: [],
			workflows: ['build', 'winget'].map(name => ({
				file: `${name}.yml`,
				name,
				events: ['workflow_dispatch'],
				jobs: [],
				localActions: [],
				dispatchInputs: ['beepboop_execution_id'],
				publication: false,
			})),
		},
	};
	const producer = await createExecution(repository, 'main', 'build', 'release:1', '1.0.0');
	producer.state = 'succeeded';
	producer.runId = 20;
	producer.artifacts = [artifact];
	const consumer = await createExecution(repository, 'main', 'winget', 'release:1', '1.0.0');
	return { producer, consumer };
}
test('artifact inputs create dependencies and carry exact producer identities', async () => {
	const { producer, consumer } = await fixture();
	expect(consumer.dependencies).toEqual([producer.id]);
	const inputs = resolveInputs(consumer, [producer]);
	expect(inputs[0]).toEqual({
		operation: 'build',
		output: 'zip',
		executionId: producer.id,
		sourceSha: producer.sourceSha,
		version: '1.0.0',
		platform: { os: 'windows', arch: 'arm64' },
		kind: 'archive',
		artifact,
	});
	expect(inputs[0]?.artifact).not.toBe(producer.artifacts[0]);
});
test('successful runs cannot complete with missing declared outputs', async () => {
	const { producer } = await fixture();
	expect(completion(producer, true)).toBe('succeeded');
	producer.artifacts = [];
	expect(completion(producer, true)).toBe('blocked');
});
test('consumer rejects wrong revision, pending producers, missing and expired artifacts', async () => {
	const { producer, consumer } = await fixture();
	expect(() => resolveInputs(consumer, [{ ...producer, sourceSha: 'b'.repeat(40) }])).toThrow('not ready');
	expect(() => resolveInputs(consumer, [{ ...producer, state: 'running' }])).toThrow('not ready');
	expect(() => resolveInputs(consumer, [{ ...producer, artifacts: [] }])).toThrow('unavailable');
	expect(() => resolveInputs(consumer, [producer], Date.parse('2100-01-01'))).toThrow('unavailable');
});
test('reports cannot replace an artifact identity or publish ambiguous named outputs', () => {
	expect(mergeArtifacts([artifact], [artifact])).toEqual([artifact]);
	expect(() => mergeArtifacts([artifact], [{ ...artifact, digest: `sha256:${'b'.repeat(64)}` }])).toThrow(
		'identity changed',
	);
	expect(() => mergeArtifacts([artifact], [{ ...artifact, id: 11 }], [{ id: 'zip', kind: 'archive' }])).toThrow(
		'Ambiguous',
	);
});
test('configuration rejects unknown artifact outputs and input dependency cycles', () => {
	const missing = structuredClone(configuration);
	missing.streams.main.workflows.winget.artifactInputs[0] = { operation: 'build', output: 'missing' };
	expect(() => parseRepositoryConfiguration(missing)).toThrow('Unknown output');
	expect(() =>
		parseRepositoryConfiguration({
			streams: {
				main: {
					workflows: {
						build: {
							file: 'build.yml',
							outputs: [{ id: 'zip', kind: 'archive' }],
							artifactInputs: [{ operation: 'build', output: 'zip' }],
						},
					},
				},
			},
		})
	).toThrow('cycle');
});
