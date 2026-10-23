import { expect, test } from 'bun:test';
import { parseRepositoryConfiguration } from '#automation/configuration';
import { createExecution } from '#automation/execution';
import { discoverHooks, planHookUpdates } from '#automation/precommit';
import type { ReleaseReference, Snapshot } from '#automation/types';

const release: ReleaseReference = {
	id: 'release-1',
	repository: { id: 1, name: 'example/hooks' },
	stream: 'main',
	commit: 'b'.repeat(40),
	version: '2.1.0',
	tag: 'v2.1.0',
	releaseId: 19,
	publications: [],
	artifacts: [],
};
const snapshot: Snapshot = {
	repository: { id: 2, name: 'example/consumer', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files: {
		'.pre-commit-config.yaml':
			`# hooks\nrepos:\n  - repo: https://github.com/example/hooks\n    rev: 'v2.0.0' # reviewed\n    hooks: [{id: check}]\n  - repo: https://github.com/example/hooks.git\n    rev: ${
				'c'.repeat(40)
			}\n    hooks: [{id: other}]\n  - repo: local\n    hooks: []\n  - repo: meta\n    hooks: []\n`,
	},
};
test('hook edits preserve comments, quoting and SHA pins', () => {
	expect(discoverHooks(snapshot)).toHaveLength(2);
	const edits = planHookUpdates(snapshot, release);
	expect(edits).toHaveLength(1);
	expect(edits[0]?.after).toContain("rev: 'v2.1.0' # reviewed");
	expect(edits[0]?.after).toContain(`rev: ${release.commit}`);
	expect(edits[0]?.after).toContain('repo: local');
	expect(planHookUpdates({ ...snapshot, files: { '.pre-commit-config.yaml': edits[0]?.after ?? '' } }, release))
		.toEqual([]);
});
test('distribution execution separates upstream release from destination checkout', async () => {
	const repository = {
		...snapshot.repository,
		sha: snapshot.sha,
		diagnostics: [],
		updatedAt: 1,
		presetShas: {},
		configuration: parseRepositoryConfiguration({
			streams: { main: { workflows: { wrapper: { file: 'wrapper.yml' } } } },
		}),
		inventory: {
			packages: [],
			managers: [],
			publicationOrder: [],
			diagnostics: [],
			workflows: [{
				file: 'wrapper.yml',
				name: 'Wrapper',
				events: ['workflow_dispatch'],
				jobs: [],
				localActions: [],
				dispatchInputs: ['beepboop_execution_id'],
				publication: true,
			}],
		},
	};
	const execution = await createExecution(repository, 'main', 'wrapper', 'delivery-1', release.version, false, release);
	expect(execution.sourceSha).toBe(snapshot.sha);
	expect(execution.upstreamRelease?.commit).toBe(release.commit);
	expect(execution.upstreamRelease?.releaseId).toBe(19);
	release.artifacts.push({ id: 1, runId: 7, name: 'extra', digest: 'sha256:fixture', expiresAt: '2030-01-01' });
	expect(execution.upstreamRelease?.artifacts).toEqual([]);
	release.artifacts.pop();
});
