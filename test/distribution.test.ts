import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseRepositoryConfiguration } from '#automation/configuration';
import { completion, createExecution, dependenciesReady } from '#automation/execution';
import { createReleasePreparation } from '#automation/managed';
import { discover, verifyPublication } from '#automation/managers';
import { resolveInputs } from '#automation/outputs';
import { planReleaseSet } from '#automation/planning';
import { planHookUpdates } from '#automation/precommit';
import { planRefs } from '#automation/refs';
import { compileReleaseSet } from '#automation/release-set';
import { matchesSubscription } from '#automation/subscriptions';
import type { Execution, ReleaseReference, RepositoryRecord, Snapshot } from '#automation/types';
import { generateManifests, renderManifests } from '../src/distribution/winget/generate.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
test('distribution contracts compose preparation, platform outputs, publication, manifests, aliases and hook consumption', async () => {
	const workflow = 'on: {workflow_dispatch: {inputs: {beepboop_execution_id: {type: string}}}}';
	const snapshot: Snapshot = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: {
			'package.json': '{"name":"tool","version":"1.0.0"}',
			'package-lock.json': '{}',
			'.github/workflows/release.yml': workflow,
		},
	};
	const binding = { file: 'release.yml' };
	const configuration = parseRepositoryConfiguration({
		streams: {
			main: {
				versioning: 'independent',
				prepare: { workflow: binding },
				promote: { workflow: binding },
				required: ['npm:tool'],
				workflows: {
					'windows-x64': binding,
					'windows-arm64': binding,
					publish: { ...binding, needs: ['promote'], publications: ['npm:tool'] },
					winget: { ...binding, needs: ['publish'] },
					aliases: {
						...binding,
						needs: ['promote', 'publish'],
						refs: { phase: 'aliases', aliases: ['major', 'minor'] },
					},
				},
			},
		},
	});
	const repository: RepositoryRecord = {
		...snapshot.repository,
		sha: snapshot.sha,
		configuration,
		inventory: discover(snapshot),
		diagnostics: [],
		presetShas: {},
		updatedAt: 0,
	};
	const platforms = ['x64', 'arm64'].map(arch => ({
		id: `windows-${arch}`,
		group: 'tool',
		platform: { os: 'windows', arch },
		outputs: [{ id: `zip-${arch}`, kind: 'archive' }],
	}));
	const inputs = platforms.map(platform => ({ operation: platform.id, output: platform.outputs[0]?.id }));
	const plan = planReleaseSet(snapshot, repository.inventory, {
		groups: [{ id: 'tool', packages: ['npm:tool'], version: { bump: 'minor' } }],
		operations: [...platforms, { id: 'promote', group: 'tool' }, { id: 'publish', group: 'tool', inputs }, {
			id: 'winget',
			group: 'tool',
			inputs,
			outputs: [{ id: 'manifests', kind: 'manifest' }],
		}, { id: 'aliases', group: 'tool' }],
	});
	const preparation = await createReleasePreparation(repository, 'main', plan);
	expect(preparation.workflow).toBeDefined();
	expect(completion(preparation, true)).toBe('blocked');
	const merged = { ...snapshot, sha: 'b'.repeat(40), files: { ...snapshot.files } };
	for (const edit of plan.edits) merged.files[edit.path] = edit.after;
	merged.files['package-lock.json'] = '{"version":"1.1.0"}';
	preparation.prepared = {
		edits: [...plan.edits, { path: 'package-lock.json', before: '{}', after: merged.files['package-lock.json'] }],
		result: { url: 'https://github.com/example/tool/pull/1', head: 'c'.repeat(40) },
	};
	preparation.state = completion(preparation, true);
	const executions = await compileReleaseSet(preparation, merged);
	const get = (name: string): Execution => {
		const result = executions.find(execution => execution.operation === name);
		if (!result) throw new Error(`Missing fixture operation: ${name}`);
		return result;
	};
	expect(dependenciesReady(get('publish'), executions)).toBe(false);
	get('promote').state = 'succeeded'; // Supply the promotion outcome for this in-process contract fixture.
	const bytes: Record<string, string> = { x64: 'synthetic x64 archive', arm64: 'synthetic arm64 archive' };
	for (const [index, arch] of ['x64', 'arm64'].entries()) {
		const build = get(`windows-${arch}`);
		expect(completion(build, true)).toBe('blocked');
		build.runId = index + 1;
		build.artifacts = [{
			id: index + 1,
			runId: index + 1,
			name: `zip-${arch}`,
			digest: `sha256:${digest(bytes[arch] ?? '')}`,
			expiresAt: '2099-01-01T00:00:00Z',
		}];
		build.state = completion(build, true);
	}
	expect(dependenciesReady(get('publish'), executions)).toBe(true);
	expect(resolveInputs(get('publish'), executions)).toHaveLength(2);
	expect(completion(get('publish'), true)).toBe('blocked');
	const publication = await verifyPublication({
		id: 'npm:tool',
		manager: 'npm',
		name: 'tool',
		version: '1.1.0',
		outcome: 'pending',
		required: true,
	}, async () => Response.json({ name: 'tool', version: '1.1.0', dist: { integrity: 'sha512-fixture' } }));
	get('publish').publications = [publication];
	get('publish').state = completion(get('publish'), true);
	expect(get('publish').state).toBe('succeeded');
	expect(dependenciesReady(get('winget'), executions)).toBe(true);
	const manifests = generateManifests({
		configuration: JSON.parse(readFileSync(new URL('../examples/winget/package.json', import.meta.url), 'utf8')),
		version: get('winget').version ?? '',
		releaseDate: '2026-10-23',
		releaseNotes: 'Synthetic release',
		checksums: `${digest(bytes.x64 ?? '')}  tool_1.1.0_windows_amd64.zip\n${
			digest(bytes.arm64 ?? '')
		}  tool_1.1.0_windows_arm64.zip\n`,
	});
	expect(manifests.installer.Installers.map(installer => installer.InstallerSha256)).toEqual(
		Object.values(bytes).map(value => digest(value).toUpperCase()),
	);
	get('winget').artifacts = [{
		id: 3,
		runId: 3,
		name: 'manifests',
		digest: `sha256:${digest(JSON.stringify(renderManifests(manifests)))}`,
		expiresAt: '2099-01-01T00:00:00Z',
	}];
	get('winget').state = completion(get('winget'), true);
	expect(get('winget').state).toBe('succeeded');
	expect(dependenciesReady(get('aliases'), executions)).toBe(true);
	expect(
		planRefs({ phase: 'aliases', prefix: 'v', aliases: ['major', 'minor'], signed: false }, '1.1.0', merged.sha, [{
			name: 'v1.1.0',
			oid: 'd'.repeat(40),
			commit: merged.sha,
		}]).map(change => change.name),
	).toEqual(['v1', 'v1.1']);
	const release: ReleaseReference = {
		id: 'fixture-release',
		repository: snapshot.repository,
		stream: 'main',
		commit: merged.sha,
		version: '1.1.0',
		group: 'tool',
		tag: 'v1.1.0',
		publications: [publication],
		artifacts: executions.flatMap(execution => execution.artifacts),
	};
	const consumer: Snapshot = {
		repository: { id: 2, name: 'example/consumer', defaultBranch: 'main' },
		sha: 'e'.repeat(40),
		files: {
			'.pre-commit-config.yaml':
				'repos:\n- repo: https://github.com/example/tool\n  rev: v1.0.0\n  hooks: [{id: check}]\n',
		},
	};
	const consumerConfiguration = parseRepositoryConfiguration({
		streams: { main: { workflows: { wrapper: binding } } },
		subscriptions: [{
			id: 'tool',
			source: 'example/tool',
			event: 'release',
			stream: 'main',
			operation: 'wrapper',
			sourceGroup: 'tool',
			publication: 'npm:tool',
		}],
	});
	const subscription = consumerConfiguration.subscriptions[0];
	if (!subscription) throw new Error('Missing fixture subscription');
	expect(matchesSubscription(subscription, { id: release.id, event: 'release', source: 'example/tool', release })).toBe(
		true,
	);
	expect(
		matchesSubscription(subscription, {
			id: release.id,
			event: 'release',
			source: 'example/tool',
			release: { ...release, group: 'another-package' },
		}),
	).toBe(false);
	const wrapper = await createExecution(
		{ ...repository, ...consumer.repository, sha: consumer.sha, configuration: consumerConfiguration },
		'main',
		'wrapper',
		release.id,
		release.version,
		false,
		release,
	);
	expect(wrapper.sourceSha).toBe(consumer.sha);
	expect(wrapper.upstreamRelease?.commit).toBe(merged.sha);
	const edits = planHookUpdates(consumer, release);
	expect(edits[0]?.after).toContain('rev: v1.1.0');
	expect(planHookUpdates({ ...consumer, files: { '.pre-commit-config.yaml': edits[0]?.after ?? '' } }, release))
		.toEqual([]);
});
