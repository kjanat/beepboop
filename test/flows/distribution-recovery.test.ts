import { expect, test } from 'bun:test';
import { bearer } from '@root/test/support/http.ts';
import { npmManifest, passChecks, publishWorkflow } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { createExecution } from '@/automation/execution';
import { Store } from '@/automation/store';
import { requireReady } from '@/domain/repository';

let world: World;
eachWorld(created => {
	world = created;
});

async function fixture() {
	const configuration = {
		managers: ['workflow', 'github-release'],
		streams: {
			main: {
				versioning: 'none',
				versionFiles: [{ path: 'package.json', format: 'json', key: ['version'] }],
				promote: {
					workflow: {
						file: 'publish.yml',
						ref: 'main',
						publications: ['github-release:octo/widget'],
						refs: {
							phase: 'version',
							signed: true,
							immutable: true,
							distribution: { files: ['dist/main.mjs'], ancestry: 'ours' },
						},
					},
				},
			},
		},
	};
	const repository = world.github.create('octo/widget', {
		'package.json': npmManifest('widget', '1.2.3', { private: true }),
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/publish.yml': publishWorkflow,
	});
	const source = world.github.head(repository);
	passChecks(repository, source);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const record = await world.run(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('Repository missing');
	const ready = await world.run(requireReady(record));
	const execution = await world.run(
		createExecution(ready, {
			stream: 'main',
			operation: 'promote',
			eventId: 'recovery',
			sourceSha: source,
			version: '1.2.3',
		}),
	);
	const coordinator = world.coordinator(repository);
	await coordinator.enqueue({ ...execution, state: 'failed', attempts: 1, approvedAt: 1 });
	const newer = world.github.push(repository, {
		'.github/workflows/publish.yml': `${publishWorkflow}\n# Corrected publication implementation\n`,
	}, 'Fix publication workflow');
	passChecks(repository, newer.sha);
	const refresh = async () => {
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	};
	await refresh();
	return { repository, source, execution, coordinator, newer, configuration, refresh };
}

test('explicit recovery uses a verified current distribution workflow while retaining the approved release', async () => {
	const { coordinator, execution, repository, source, newer } = await fixture();
	const recovered = await coordinator.recover(execution.id, 'redispatch', 'maintainer');
	expect(recovered.state).toBe('ready');
	expect(recovered.currentWorkflow).toBe(true);
	expect(recovered.sourceSha).toBe(source);
	expect(recovered.version).toBe('1.2.3');
	expect(recovered.configuration).toEqual(execution.configuration);
	expect(recovered.configurationSha).toBe(execution.configurationSha);
	expect(recovered.refPlan).toBeUndefined();
	await world.wait(16_000);
	expect(repository.runs.filter(run => run.inputs.beepboop_execution_id === execution.id).map(run => run.headSha))
		.toEqual([newer.sha]);
});

for (
	const problem of ['unverified signature', 'failed checks', 'pending checks', 'changed allowlist', 'changed version']
) {
	test(`unpublished distribution recovery rejects ${problem} before dispatch`, async () => {
		const { coordinator, execution, repository, newer, configuration, refresh } = await fixture();
		if (problem === 'unverified signature') newer.verified = false;
		else if (problem === 'failed checks') {
			repository.checks.set(newer.sha, [{ name: 'test', status: 'completed', conclusion: 'failure' }]);
		} else if (problem === 'pending checks') repository.checks.delete(newer.sha);
		else {
			const changed = world.github.push(
				repository,
				problem === 'changed allowlist'
					? {
						'.github/beepboop.json': JSON.stringify({
							...configuration,
							streams: {
								main: {
									...configuration.streams.main,
									promote: {
										workflow: {
											...configuration.streams.main.promote.workflow,
											refs: {
												...configuration.streams.main.promote.workflow.refs,
												distribution: { files: ['dist/other.mjs'], ancestry: 'ours' },
											},
										},
									},
								},
							},
						}),
					}
					: { 'package.json': npmManifest('widget', '1.2.4', { private: true }) },
				problem,
			);
			passChecks(repository, changed.sha);
			await refresh();
		}
		await expect(coordinator.recover(execution.id, 'redispatch', 'maintainer')).rejects.toThrow(
			problem.startsWith('changed')
				? 'The release version or configuration changed'
				: 'The current workflow commit must be verified with passing checks',
		);
		expect((await coordinator.execution(execution.id))?.state).toBe('failed');
		expect(repository.runs).toEqual([]);
	});
}
