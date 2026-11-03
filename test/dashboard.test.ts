import { expect, test } from 'bun:test';
import { configuredGrant } from '@/automation/access';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import type { Execution, RepositoryRecord } from '@/automation/types';
import { releaseSetSummaries, releaseSummaries } from '@/server/releases';

const repository: RepositoryRecord = {
	id: 91,
	name: 'example/tool',
	defaultBranch: 'main',
	sha: 'a'.repeat(40),
	updatedAt: 1,
	configuration: parseRepositoryConfiguration({
		streams: {
			main: {
				credentials: ['npm-token'],
				workflows: { publish: { file: 'publish.yml', ref: 'refs/tags/v*' } },
				required: ['npm:tool', 'cargo:tool'],
			},
		},
	}),
	presetShas: {},
	diagnostics: [],
	inventory: { packages: [], workflows: [], managers: [], diagnostics: [], publicationOrder: [] },
};
const selection = { alias: 'npm-token', stream: 'main', operation: 'publish', delivery: 'runtime' };
test('workflow permission resolves trusted scope and creates its own identifier', () => {
	const grant = configuredGrant(repository, {
		...selection,
		id: 'forged',
		repository: 'other/repo',
		workflow: 'other.yml',
		ref: 'refs/heads/evil',
	});
	expect(grant.repositoryId).toBe(91);
	expect(grant.repository).toBe('example/tool');
	expect(grant.workflow).toBe('publish.yml');
	expect(grant.ref).toBe('refs/tags/v*');
	expect(grant.id).not.toBe('forged');
	expect(configuredGrant(repository, selection).id).not.toBe(grant.id);
});
test('permission refuses unavailable repositories, unknown workflows and undeclared runtime names', () => {
	expect(() => configuredGrant({ ...repository, suspended: true }, selection)).toThrow('not ready');
	expect(() => configuredGrant(repository, { ...selection, operation: 'missing' })).toThrow('configured workflow');
	expect(() => configuredGrant(repository, { ...selection, alias: 'undeclared' })).toThrow('credentials list');
	expect(() => configuredGrant(repository, { ...selection, delivery: 'environment', secretName: 'NPM_TOKEN' })).toThrow(
		'Environment required',
	);
	expect(
		configuredGrant(repository, { ...selection, delivery: 'environment', secretName: 'NPM_TOKEN', environment: 'npm' })
			.environment,
	).toBe('npm');
});
function run(id: string, publication: string, sourceSha = 'b'.repeat(40)): Execution {
	if (!repository.configuration) throw new Error('Missing fixture configuration');
	return {
		id,
		repositoryId: 91,
		repository: repository.name,
		stream: 'main',
		operation: id,
		eventId: id,
		configuration: repository.configuration,
		configurationSha: repository.sha,
		presetShas: {},
		sourceSha,
		version: '1.0.0',
		state: 'succeeded',
		dependencies: [],
		attempts: 1,
		artifacts: [],
		createdAt: 1,
		updatedAt: 2,
		publications: [{
			id: publication,
			manager: publication.startsWith('npm') ? 'npm' : 'cargo',
			name: 'tool',
			version: '1.0.0',
			outcome: 'succeeded',
			required: true,
		}],
	};
}
test('release overview combines publication evidence only for the same revision and version', () => {
	const npm = run('npm', 'npm:tool'), cargo = run('cargo', 'cargo:tool');
	expect(releaseSummaries([npm, cargo])[0]?.verified).toBe(2);
	const unrelated = releaseSummaries([npm, { ...cargo, sourceSha: 'c'.repeat(40) }]);
	expect(unrelated).toHaveLength(2);
	expect(unrelated.every(r => r.verified === 1)).toBe(true);
	expect(releaseSummaries([npm, { ...cargo, version: '2.0.0' }])).toHaveLength(2);
	expect(releaseSummaries([npm, { ...cargo, configurationSha: 'd'.repeat(40) }])).toHaveLength(2);
});

test('monorepo overview isolates preparations and uses each group publication contract', () => {
	const npm = run('npm', 'npm:tool');
	npm.releaseSet = {
		preparationId: 'first',
		group: 'npm',
		required: ['npm:tool'],
		workflowId: 'release-first',
		operationCount: 2,
	};
	const cargo = run('cargo', 'cargo:tool');
	cargo.version = '2.0.0';
	cargo.releaseSet = { ...npm.releaseSet, group: 'cargo', required: ['cargo:tool'] };
	expect(releaseSummaries([npm, cargo]).map(group => group.publications.length)).toEqual([1, 1]);
	expect(releaseSetSummaries([npm, cargo])[0]?.state).toBe('succeeded');
	// A dashboard history window containing only one operation must not claim completion.
	expect(releaseSetSummaries([npm])[0]?.state).toBe('in progress');
	const another = { ...npm, releaseSet: { ...npm.releaseSet, preparationId: 'second', workflowId: 'release-second' } };
	expect(releaseSummaries([npm, another])).toHaveLength(2);
	expect(releaseSetSummaries([npm, another])).toHaveLength(2);
	expect(releaseSetSummaries([npm, { ...cargo, state: 'failed' }])[0]?.state).toBe('needs attention');
});
