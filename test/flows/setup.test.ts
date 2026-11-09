import { expect, test } from 'bun:test';
import { bearer, field } from '@root/test/support/http.ts';
import { publishWorkflow, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { applySetup, discoverSetup, editPull } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Result } from 'effect';
import { parse, parseDocument } from 'yaml';
import { z } from 'zod';
import { mergeConfiguration } from '@/automation/configuration';
import { pinned } from '@/automation/setup-actions';
import { describeEdits, setupTitle } from '@/automation/setup-changes';
import { cratePublishCommands, ledgerCommand, suggestedCommands } from '@/automation/setup-defaults';
import { rebuildingStatus } from '@/automation/setup-maintenance';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import { publishMinutes } from '@/automation/setup-workflows';

const checkout = pinned('checkout');
let world: World;
eachWorld(created => {
	world = created;
});

test('a discovered repository can preview, open and refresh its setup PR', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const initial = await api('/api/repositories/setup/preview', { repository: repository.name });
	expect(initial.status).toBe(200);
	const suggested = await Effect.runPromise(parseSetupPlan(initial.body));
	expect(suggested.packageIds).toContain('pkg:npm/widget');
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			prepare: {
				file: 'prepare.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'npm install',
				publicationSteps: {},
			},
			promote: {
				file: 'release.yml',
				job: 'promote',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
			},
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	expect(preview.status).toBe(200);
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const applied = await applySetup(api, repository.name, plan, choices);
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
	const refreshed = await api('/api/repositories/setup/preview', { repository: repository.name });
	expect(refreshed.status).toBe(200);
	const next = await Effect.runPromise(parseSetupPlan(refreshed.body));
	expect(next.blockers).toEqual([]);
	expect(next.choices).toEqual(plan.choices);
	const reapplied = await applySetup(api, repository.name, next, next.choices);
	expect(reapplied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
});

const workflowSchema = z.object({
	jobs: z.object({
		publish: z.object({
			steps: z.array(z.object({
				uses: z.string().optional(),
				run: z.string().optional(),
				id: z.string().optional(),
				with: z.record(z.string(), z.unknown()).optional(),
			})),
		}),
	}),
});

for (const configured of [false, true]) {
	test(`setup adopts an existing integration with managed preparation (configured=${configured})`, async () => {
		const repository = widget(world.github, { configured });
		const api = bearer(world, await world.cliSession());
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
		expect(preview.status).toBe(200);
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		expect(plan.choices.streams[0]?.prepare).toBeUndefined();
		const applied = await applySetup(api, repository.name, plan, plan.choices);
		expect(applied.status).toBe(200);
		expect(repository.pulls).toHaveLength(1);
		const edit = plan.edits.find(edit => edit.path === '.github/workflows/publish.yml');
		const steps = workflowSchema.parse(parse(edit?.after ?? '')).jobs.publish.steps;
		expect(steps.map(step => step.uses ?? step.run)).toEqual([
			checkout,
			'kjanat/beepboop/actions/begin@actions',
			checkout,
			'npm publish',
			'kjanat/beepboop/actions/report@actions',
		]);
		expect(steps[2]?.with).toEqual({
			ref: '${{ fromJSON(steps.release.outputs.context).sourceSha }}',
			'persist-credentials': false,
		});
		const refresh = await api('/api/repositories/setup/preview', { repository: repository.name });
		const refreshed = await Effect.runPromise(parseSetupPlan(refresh.body));
		expect(refreshed.blockers).toEqual([]);
		expect(refreshed.edits).toEqual(plan.edits);
		world.github.merge(repository, 1);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		expect(
			(await api('/api/releases/plan', {
				repositoryId: repository.id,
				stream: 'main',
				version: '1.1.0',
			})).status,
		).toBe(200);
	});
}

test('adoption keeps an ordinary checkout before begin on the latest checkout major', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/publish.yml': publishWorkflow.replace(
			'    steps:\n',
			`    steps:
      - uses: actions/checkout@v6
        id: source
        with:
          fetch-depth: 0
`,
		),
	}, 'Use a root checkout before setup');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const edit = plan.edits.find(edit => edit.path === '.github/workflows/publish.yml');
	const steps = workflowSchema.parse(parse(edit?.after ?? '')).jobs.publish.steps;
	expect(steps[0]).toEqual({
		uses: checkout,
		id: 'source',
		with: { 'fetch-depth': 0, 'persist-credentials': false },
	});
	expect(steps[1]?.uses).toBe('kjanat/beepboop/actions/begin@actions');
	expect(steps[2]?.uses).toBe(checkout);
	expect(steps[2]?.with?.ref).toBe('${{ fromJSON(steps.release.outputs.context).sourceSha }}');
});

test('integration moves an old checkout to the latest checkout major', async () => {
	const repository = binaryRepository();
	world.github.push(repository, {
		'.github/workflows/release.yml': `name: Release
on: workflow_dispatch
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
`,
	}, 'Add a release workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const { jobs } = binaryWorkflowSchema.parse(parse(after));
	const checkouts = Object.values(jobs).flatMap(job => job.steps)
		.filter(step => step.uses?.startsWith('actions/checkout@'));
	expect(checkouts.length).toBe(5);
	expect(new Set(checkouts.map(step => step.uses))).toEqual(new Set([checkout]));
	expect(jobs.publish?.steps[0]?.with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
});

for (const preparation of ['run: npm install', 'uses: octo/build-artifacts@v1']) {
	test(`adoption refuses to clean workspace preparation before begin (${preparation})`, async () => {
		const repository = widget(world.github, { configured: false });
		world.github.push(repository, {
			'.github/workflows/publish.yml': publishWorkflow.replace(
				'    steps:\n',
				`    steps:
      - uses: actions/checkout@v7
      - ${preparation}
`,
			),
		}, 'Prepare workspace before begin');
		const api = bearer(world, await world.cliSession());
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toContain(
			'publish.yml: steps before begin need explicit integration; prepare dependencies and build output after the approved checkout',
		);
		expect(plan.edits.find(edit => edit.path === '.github/workflows/publish.yml')).toBeUndefined();
		const applied = await applySetup(api, repository.name, plan, plan.choices);
		expect(applied.status).toBe(422);
		expect(repository.pulls).toHaveLength(0);
	});
}

for (const versioning of ['workspace', 'independent', 'none'] as const) {
	test(`tag-only packages need a preparation workflow (versioning=${versioning})`, async () => {
		const repository = world.github.create('octo/tagged', { 'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n' });
		const api = bearer(world, await world.cliSession());
		const choices: SetupChoices = {
			streams: [{
				name: 'main',
				packages: ['pkg:golang/github.com/octo/tagged'],
				required: [],
				versioning,
				promote: {
					file: 'publish.yml',
					job: 'publish',
					triggers: 'review',
					commands: 'goreleaser release',
					publicationSteps: {},
				},
			}],
		};
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([
			'main: select a preparation workflow; managed preparation needs a version stored in a file.',
		]);
		const applied = await applySetup(api, repository.name, plan, plan.choices);
		expect(applied.status).toBe(422);
		expect(repository.pulls).toHaveLength(0);
	});
}

test('tag-only packages with a version file can use managed preparation', async () => {
	const repository = world.github.create('octo/tagged', {
		'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n',
		'VERSION': 'version=1.0.0\n',
		'.github/beepboop.json': JSON.stringify({
			managers: ['go', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:golang/github.com/octo/tagged'],
					versionFiles: [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }],
				},
			},
		}),
	});
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: {
			streams: [{
				name: 'main',
				packages: ['pkg:golang/github.com/octo/tagged'],
				required: [],
				versioning: 'workspace',
				promote: {
					file: 'publish.yml',
					job: 'publish',
					triggers: 'review',
					commands: 'goreleaser release',
					publicationSteps: {},
				},
			}],
		},
	});
	const setup = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(setup.blockers).toEqual([]);
	expect(
		(await applySetup(api, repository.name, setup, setup.choices)).status,
	).toBe(200);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const release = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(release.status).toBe(200);
	expect(field(release.body, 'requiresPreparation')).toBe(false);
	expect(field(release.body, 'edits')).toEqual([{
		path: 'VERSION',
		before: 'version=1.0.0\n',
		after: 'version=1.1.0\n',
	}]);
	expect(
		(await api('/api/releases/prepare', {
			repositoryId: repository.id,
			stream: 'main',
			version: '1.1.0',
			planId: field(release.body, 'planId'),
			sourceSha: field(release.body, 'sourceSha'),
		})).status,
	).toBe(200);
});

test('managed setup still requires a workflow to regenerate lockfiles', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, { 'package-lock.json': '{"lockfileVersion":3}\n' }, 'Add a lockfile');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('main: select a preparation workflow to regenerate lockfiles.');
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(422);
	expect(repository.pulls).toHaveLength(0);
});

test('a uv lockfile needs a preparation workflow that runs uv lock', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, { 'bindings/python/uv.lock': 'version = 1\n' }, 'Add a uv lockfile');
	const api = bearer(world, await world.cliSession());
	const plan = await Effect.runPromise(parseSetupPlan(
		(await api('/api/repositories/setup/preview', { repository: repository.name })).body,
	));
	expect(plan.preparation?.lockfiles).toEqual(['bindings/python/uv.lock']);
	expect(plan.blockers).toContain('main: select a preparation workflow to regenerate lockfiles.');
	const widgetPackage = { id: 'pkg:npm/widget', name: 'widget', manifest: 'package.json', manager: 'npm' };
	expect(suggestedCommands('prepare', { name: 'main', packages: [widgetPackage] }, plan)).toBe(
		'npm install\nnpm run test --if-present\nuv lock',
	);
	expect(suggestedCommands('promote', { name: 'main', packages: [widgetPackage] }, plan)).toBe(ledgerCommand);
});

const binaryWorkflowSchema = z.object({
	jobs: z.record(
		z.string(),
		z.object({
			'runs-on': z.string(),
			needs: z.array(z.string()).optional(),
			permissions: z.record(z.string(), z.string()).optional(),
			outputs: z.record(z.string(), z.string()).optional(),
			strategy: z.object({ matrix: z.object({ include: z.array(z.record(z.string(), z.string())) }) }).optional(),
			steps: z.array(z.object({
				uses: z.string().optional(),
				run: z.string().optional(),
				id: z.string().optional(),
				name: z.string().optional(),
				env: z.record(z.string(), z.string()).optional(),
				with: z.record(z.string(), z.unknown()).optional(),
			})),
		}),
	),
});
function binaryRepository() {
	return world.github.create('octo/signer', {
		'client/go.mod': 'module github.com/octo/signer/client\n\ngo 1.26\n',
		'client/go.sum': '',
		'client/cmd/signer/main.go': 'package main\n\nvar version = "dev"\n\nfunc main() {}\n',
		'tool/Cargo.toml': '[package]\nname = "tool"\nversion = "0.0.0"\nedition = "2024"\n',
		'tool/Cargo.lock': 'version = 4\n',
		'bun.lock': '{}\n',
	});
}
function binaryChoices(promote: Partial<NonNullable<SetupChoices['streams'][number]['promote']>> = {}): SetupChoices {
	return {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'workspace',
			versionSource: { kind: 'tags', prefix: 'v' },
			promote: {
				file: 'release.yml',
				job: 'publish',
				triggers: 'review',
				commands: '',
				publicationSteps: {},
				binaries: {
					builds: [
						{
							toolchain: 'go',
							name: 'signer',
							module: 'client',
							package: './cmd/signer',
							asset: '{name}-{go.os}-{go.arch}{ext}',
						},
						{ toolchain: 'cargo', name: 'tool', manifest: 'tool/Cargo.toml', asset: '{name}-{rust.target}{ext}' },
					],
					targets: ['linux-amd64', 'darwin-arm64', 'windows-amd64'],
				},
				...promote,
			},
		}],
	};
}

test('a publication workflow builds each binary in a platform matrix and releases the assets', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const choices = binaryChoices();
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	expect(preview.status).toBe(200);
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const edit = plan.edits.find(edit => edit.path === '.github/workflows/release.yml');
	const { jobs } = binaryWorkflowSchema.parse(parse(edit?.after ?? ''));
	expect(Object.keys(jobs)).toEqual(['begin', 'build-signer', 'build-tool', 'publish']);
	expect(edit?.after).toMatch(/^jobs:\n {2}begin:\n {4}name: /m);
	expect(edit?.after).toMatch(/^ {2}publish:\n/m);
	expect(
		Object.entries(jobs).filter(([, job]) => job.permissions?.['id-token'] === 'write').map(([name]) => name),
	).toEqual(['begin', 'publish']);
	expect(jobs.begin?.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
	expect(jobs.begin?.steps.map(step => step.uses)).toEqual([checkout, 'kjanat/beepboop/actions/begin@v1']);
	expect(jobs.begin?.outputs).toEqual({
		sourceSha: '${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}',
		version: '${{ fromJSON(steps.beepboop.outputs.context).version }}',
	});
	const uses = Object.values(jobs).flatMap(job => job.steps.flatMap(step => step.uses ?? []));
	expect(uses.filter(action => !action.startsWith('kjanat/beepboop/') && !/@[0-9a-f]{40}$/.test(action))).toEqual([]);
	for (const action of new Set(uses.filter(action => !action.startsWith('kjanat/beepboop/')))) {
		expect(edit?.after).toContain(`uses: ${action} # v`);
	}
	expect(jobs['build-signer']?.['runs-on']).toBe('ubuntu-latest');
	expect(jobs['build-signer']?.strategy?.matrix.include).toEqual([
		{ goos: 'linux', goarch: 'amd64', asset: 'signer-linux-amd64' },
		{ goos: 'darwin', goarch: 'arm64', asset: 'signer-darwin-arm64' },
		{ goos: 'windows', goarch: 'amd64', asset: 'signer-windows-amd64.exe' },
	]);
	expect(jobs['build-tool']?.['runs-on']).toBe('${{ matrix.runner }}');
	expect(jobs['build-tool']?.strategy?.matrix.include).toEqual([
		{ runner: 'ubuntu-latest', target: 'x86_64-unknown-linux-gnu', ext: '', asset: 'tool-x86_64-unknown-linux-gnu' },
		{ runner: 'macos-latest', target: 'aarch64-apple-darwin', ext: '', asset: 'tool-aarch64-apple-darwin' },
		{
			runner: 'windows-latest',
			target: 'x86_64-pc-windows-msvc',
			ext: '.exe',
			asset: 'tool-x86_64-pc-windows-msvc.exe',
		},
	]);
	for (const job of ['build-signer', 'build-tool']) {
		const steps = jobs[job]?.steps ?? [];
		expect(jobs[job]?.needs).toEqual(['begin']);
		expect(jobs[job]?.permissions).toEqual({ contents: 'read' });
		expect(steps[0]).toEqual({
			uses: checkout,
			with: { ref: '${{ needs.begin.outputs.sourceSha }}', 'persist-credentials': false },
		});
		expect(steps.find(step => step.id === 'asset')?.env?.VERSION).toBe('${{ needs.begin.outputs.version }}');
		expect(steps.at(-1)?.uses).toBe(pinned('upload'));
	}
	expect(jobs['build-signer']?.steps.find(step => step.run?.startsWith('go build'))?.env).toMatchObject({
		GOOS: '${{ matrix.goos }}',
		MODULE: 'client',
		PACKAGE: './cmd/signer',
	});
	expect(jobs.publish?.needs).toEqual(['build-signer', 'build-tool']);
	expect(jobs.publish?.permissions).toEqual({ contents: 'write', 'id-token': 'write', attestations: 'write' });
	expect(jobs.publish?.steps.map(step => step.uses ?? step.id ?? step.name)).toEqual([
		checkout,
		'kjanat/beepboop/actions/begin@v1',
		checkout,
		pinned('download'),
		'Write checksums',
		pinned('sbom'),
		pinned('attest'),
		pinned('attest'),
		'beepboop_binaries',
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/publish-release@v1',
		'kjanat/beepboop/actions/report@v1',
	]);
	const sbom = '${{ github.event.repository.name }}';
	expect(jobs.publish?.steps.find(step => step.uses === pinned('sbom'))?.with).toEqual({
		path: 'dist',
		format: 'spdx-json',
		'output-file': `dist/${sbom}.spdx.json`,
		'upload-artifact': false,
		'upload-release-assets': false,
	});
	expect(jobs.publish?.steps.filter(step => step.uses === pinned('attest')).map(step => step.with)).toEqual([
		{ 'subject-checksums': 'dist/checksums.txt' },
		{ 'subject-checksums': 'dist/checksums.txt', 'sbom-path': `dist/${sbom}.spdx.json` },
	]);
	const configuration = z.object({
		managers: z.array(z.string()),
		streams: z.record(z.string(), z.object({ promote: z.object({ workflow: z.record(z.string(), z.unknown()) }) })),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.managers).toContain('github-release');
	expect(configuration.streams.main?.promote.workflow).toMatchObject({
		file: 'release.yml',
		publications: ['github-release:octo/signer'],
		refs: { phase: 'version', prefix: 'v' },
	});
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
});

test('binary builds whose asset names collide block setup', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices({
			binaries: {
				builds: [{ toolchain: 'go', name: 'signer', module: 'client', package: './cmd/signer', asset: '{name}{ext}' }],
				targets: ['linux-amd64', 'linux-arm64'],
			},
		}),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual(['release.yml: signer linux-amd64 and signer linux-arm64 both produce signer']);
});

test('binary builds join an existing publication workflow and stay stable on a rerun', async () => {
	const repository = binaryRepository();
	world.github.push(repository, { '.github/workflows/release.yml': publishWorkflow }, 'Add a release workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const { jobs } = binaryWorkflowSchema.parse(parse(after));
	expect(Object.keys(jobs)).toEqual(['begin', 'build-signer', 'build-tool', 'publish']);
	expect(after).toMatch(/^jobs:\n {2}begin:\n {4}name: /m);
	expect(jobs.begin?.steps[1]).toMatchObject({ uses: 'kjanat/beepboop/actions/begin@v1', id: 'release' });
	expect(jobs.begin?.outputs?.sourceSha).toBe('${{ fromJSON(steps.release.outputs.context).sourceSha }}');
	expect(jobs.publish?.needs).toEqual(['build-signer', 'build-tool']);
	expect(jobs.publish?.steps.map(step => step.uses ?? step.id ?? step.name ?? step.run)).toEqual([
		checkout,
		'kjanat/beepboop/actions/begin@actions',
		checkout,
		'npm publish',
		pinned('download'),
		'Write checksums',
		pinned('sbom'),
		pinned('attest'),
		pinned('attest'),
		'beepboop_binaries',
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/publish-release@v1',
		'kjanat/beepboop/actions/report@actions',
	]);
	world.github.push(repository, { '.github/workflows/release.yml': after }, 'Integrate binary builds');
	const rerun = await api('/api/repositories/setup/preview', { repository: repository.name, choices: binaryChoices() });
	const replanned = await Effect.runPromise(parseSetupPlan(rerun.body));
	expect(replanned.blockers).toEqual([]);
	expect(replanned.edits.find(edit => edit.path === '.github/workflows/release.yml')).toBeUndefined();
});

test('binary builds leave the other jobs of an existing workflow untouched', async () => {
	const repository = binaryRepository();
	const lint = `  lint:
    runs-on: ubuntu-latest
    steps:
      # Pinned for the audit trail.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: make lint
`;
	world.github.push(
		repository,
		{ '.github/workflows/release.yml': publishWorkflow.replace('jobs:\n', `jobs:\n${lint}`) },
		'Add a release workflow',
	);
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	expect(after).toContain(lint);
	expect(Object.keys(binaryWorkflowSchema.parse(parse(after)).jobs)).toEqual([
		'begin',
		'build-signer',
		'build-tool',
		'lint',
		'publish',
	]);
});

test('binary builds refuse jobs given as an alias', async () => {
	const repository = binaryRepository();
	const workflow = publishWorkflow.replace('jobs:\n', 'shared: &jobs\n').concat('jobs: *jobs\n');
	world.github.push(repository, { '.github/workflows/release.yml': workflow }, 'Add a release workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('release.yml: jobs must be a plain mapping, not an alias');
});

test('setup writes the selected version files into the stream', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const choices = binaryChoices();
	const stream = choices.streams[0];
	if (!stream) throw new Error('stream expected');
	choices.streams[0] = {
		...stream,
		versionFiles: [{ path: 'tool/Cargo.toml', format: 'toml', key: ['package', 'version'], template: '{version}' }],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const configuration = z.object({
		streams: z.record(z.string(), z.object({ versionFiles: z.array(z.record(z.string(), z.unknown())) })),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.streams.main?.versionFiles).toEqual([
		{ path: 'tool/Cargo.toml', format: 'toml', key: ['package', 'version'], template: '{version}' },
	]);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
});

function credentialChoices(file: string, commands: string): SetupChoices {
	return {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: {
				file,
				job: 'publish',
				triggers: 'review',
				commands,
				publicationSteps: {},
				credentials: { NODE_AUTH_TOKEN: 'npm-token' },
			},
		}],
	};
}

test('setup delivers selected credentials to the publishing commands', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	const choices = credentialChoices('release-widget.yml', 'npm publish');
	const inferred = await Effect.runPromise(parseSetupPlan(
		(await api('/api/repositories/setup/preview', { repository: repository.name })).body,
	));
	expect(inferred.adoption?.length).toBeGreaterThan(0);
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(plan.adoption).toBeUndefined();
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release-widget.yml')?.after ?? '';
	const steps = binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? [];
	const credentials = steps.findIndex(step => step.id === 'beepboop_credentials');
	expect(steps[credentials]).toEqual({
		id: 'beepboop_credentials',
		uses: 'kjanat/beepboop/actions/credentials@v1',
		with: { 'execution-id': '${{ steps.beepboop.outputs.execution-id }}', aliases: '["npm-token"]' },
	});
	expect(steps[credentials + 1]).toMatchObject({
		id: 'beepboop_publish',
		run: 'npm publish',
		env: { NODE_AUTH_TOKEN: "${{ fromJSON(steps.beepboop_credentials.outputs.values)['npm-token'] }}" },
	});
	const configuration = z.object({
		streams: z.record(z.string(), z.object({ credentials: z.array(z.string()) })),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.streams.main?.credentials).toEqual(['npm-token']);
	expect(plan.notes).toContain(
		'release-widget.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation.',
	);
});

test('generated workflows keep every expression on one line', async () => {
	const repository = world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n[workspace.package]\nversion = "1.0.0"\n',
		'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml': '[package]\nname = "lint"\nversion.workspace = true\n',
		'go/go.mod': 'module github.com/octo/lint/go\n\ngo 1.26\n',
		'mise.toml': '[tools]\nrust = "stable"\n',
	});
	const packages = ['pkg:cargo/lint-core', 'pkg:cargo/lint', 'pkg:golang/github.com/octo/lint/go'];
	const api = bearer(world, await world.cliSession());
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages,
			required: packages,
			versioning: 'workspace',
			prepare: {
				file: 'prepare-release.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo update --workspace\ncargo test --workspace --locked',
				publicationSteps: {},
			},
			promote: {
				file: 'release-crates.yml',
				job: 'publish',
				triggers: 'review',
				commands: "cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint'",
				publicationSteps: {},
				credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
				tagPrefix: 'lint-v',
			},
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const workflows = plan.edits.filter(edit => edit.path.startsWith('.github/workflows/'));
	expect(workflows.map(edit => edit.path).sort()).toEqual([
		'.github/workflows/prepare-release.yml',
		'.github/workflows/release-crates.yml',
	]);
	for (const edit of workflows) {
		expect(parseDocument(edit.after ?? '').errors).toEqual([]);
		for (const line of (edit.after ?? '').split('\n')) {
			expect({ line, closes: line.split('}}').length }).toEqual({ line, closes: line.split('${{').length });
		}
	}
	const release = workflows.find(edit => edit.path === '.github/workflows/release-crates.yml')?.after ?? '';
	const report = binaryWorkflowSchema.parse(parse(release)).jobs.publish?.steps.find(step => step.with?.publications);
	const publications = z.array(z.object({ id: z.string(), outcome: z.string() })).parse(
		JSON.parse(String(report?.with?.publications)),
	);
	expect(publications.map(entry => entry.id)).toEqual([
		'pkg:cargo/lint',
		'pkg:cargo/lint-core',
		'pkg:golang/github.com/octo/lint/go',
	]);
	expect(publications.map(entry => entry.outcome)).toEqual([
		"${{ steps.beepboop_publish.outcome == 'success' && 'succeeded' || 'failed' }}",
		"${{ steps.beepboop_publish.outcome == 'success' && 'succeeded' || 'failed' }}",
		"${{ steps.beepboop_refs.outcome == 'success' && 'succeeded' || 'failed' }}",
	]);
});

test('setup installs the mise toolchain before the setup commands', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	const choices = credentialChoices('release-widget.yml', 'npm publish');
	const stepsOf = async () => {
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		const after = plan.edits.find(edit => edit.path === '.github/workflows/release-widget.yml')?.after ?? '';
		return (binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? []).map(step => step.uses ?? step.id);
	};
	expect(await stepsOf()).not.toContain(pinned('mise'));
	world.github.push(repository, { 'mise.toml': '[tools]\nnode = "24"\n' }, 'Pin the toolchain');
	const steps = await stepsOf();
	expect(steps.slice(steps.indexOf(pinned('mise')), steps.indexOf('beepboop_publish') + 1)).toEqual([
		pinned('mise'),
		'kjanat/beepboop/actions/credentials@v1',
		'beepboop_publish',
	]);
});

test('setup refuses credentials that no setup command receives', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	const choices = credentialChoices('publish.yml', '');
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain(
		'publish.yml: credentials need setup commands to receive them, or a beepboop_credentials step in the job',
	);
});

test('a tag prefix makes the publication workflow push its version tag with the App token', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	const choices = credentialChoices('release-widget.yml', 'npm publish');
	const promote = choices.streams[0]?.promote;
	if (!promote) throw new Error('promote expected');
	promote.tagPrefix = 'widget-v';
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release-widget.yml')?.after ?? '';
	const steps = binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? [];
	expect(steps.slice(-5).map(step => step.uses ?? step.id)).toEqual([
		'beepboop_publish',
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/publish-release@v1',
		'kjanat/beepboop/actions/report@v1',
	]);
	expect(steps.at(-2)?.with).toEqual({ 'execution-id': '${{ steps.beepboop.outputs.execution-id }}' });
	expect(steps.at(-4)).toEqual({
		id: 'beepboop_token',
		uses: 'kjanat/beepboop/actions/token@v1',
		with: { 'execution-id': '${{ steps.beepboop.outputs.execution-id }}', 'permission-contents': 'write' },
	});
	expect(steps.at(-3)?.with).toEqual({ token: '${{ steps.beepboop_token.outputs.token }}' });
	const configuration = z.object({
		streams: z.record(z.string(), z.object({ promote: z.object({ workflow: z.record(z.string(), z.unknown()) }) })),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.streams.main?.promote.workflow.refs).toEqual({ phase: 'version', prefix: 'widget-v' });
	expect(configuration.streams.main?.promote.workflow.publications).toEqual([
		'pkg:npm/widget',
		'github-release:octo/widget',
	]);
});

test('a tag prefix adds ref publication before the report of an existing workflow, once', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	const choices = credentialChoices('publish.yml', '');
	const promote = choices.streams[0]?.promote;
	if (!promote) throw new Error('promote expected');
	promote.credentials = undefined;
	promote.publicationSteps = { 'pkg:npm/widget': 'publish' };
	promote.tagPrefix = 'v';
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	const after = plan.edits.find(edit => edit.path === '.github/workflows/publish.yml')?.after ?? '';
	const steps = binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? [];
	expect(steps.slice(-3).map(step => step.uses)).toEqual([
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/report@actions',
	]);
	world.github.push(repository, { '.github/workflows/publish.yml': after }, 'Publish the version tag');
	const rerun = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const replanned = await Effect.runPromise(parseSetupPlan(rerun.body));
	expect(replanned.edits.find(edit => edit.path === '.github/workflows/publish.yml')).toBeUndefined();
});

test('the promote report leaves out observed publications and reports Go modules from the tag push', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, { 'go/go.mod': 'module github.com/octo/widget/go\n\ngo 1.26\n' }, 'Add a Go module');
	const api = bearer(world, await world.cliSession());
	const inspected = await Effect.runPromise(parseSetupPlan(
		(await api('/api/repositories/setup/preview', { repository: repository.name })).body,
	));
	const goModule = inspected.packageIds.find(id => id.startsWith('pkg:golang/'));
	if (!goModule) throw new Error('Go module expected');
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget', goModule],
			required: ['pkg:npm/widget', goModule],
			versioning: 'workspace',
			observe: [{ name: 'npm', file: 'publish.yml', ref: 'master', publications: ['pkg:npm/widget'] }],
			promote: {
				file: 'release-widget.yml',
				job: 'publish',
				triggers: 'review',
				commands: '',
				publicationSteps: {},
				tagPrefix: 'v',
			},
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release-widget.yml')?.after ?? '';
	const steps = binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? [];
	const report = steps.find(step => step.uses === 'kjanat/beepboop/actions/report@v1');
	expect(JSON.parse(String(report?.with?.publications))).toEqual([{
		id: goModule,
		manager: 'go',
		name: 'github.com/octo/widget/go',
		version: '${{ fromJSON(steps.beepboop.outputs.context).version }}',
		required: true,
		outcome: "${{ steps.beepboop_refs.outcome == 'success' && 'succeeded' || 'failed' }}",
	}]);
	expect(steps.map(step => step.id).filter(Boolean)).toEqual(['beepboop', 'beepboop_token', 'beepboop_refs']);
});

test('setup refuses a selected version file that does not exist', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const choices = binaryChoices();
	const stream = choices.streams[0];
	if (!stream) throw new Error('stream expected');
	choices.streams[0] = {
		...stream,
		versionFiles: [{
			path: 'python/pyproject.toml',
			format: 'toml',
			key: ['project', 'version'],
			template: '{version}',
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('Stream main edits python/pyproject.toml, which does not exist');
});

for (const name of ['build-signer', 'begin']) {
	test(`binary builds refuse a foreign job named ${name}`, async () => {
		const repository = binaryRepository();
		const workflow = publishWorkflow.replace(
			'jobs:\n',
			`jobs:\n  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n`,
		);
		world.github.push(repository, { '.github/workflows/release.yml': workflow }, 'Add a release workflow');
		const api = bearer(world, await world.cliSession());
		const preview = await api('/api/repositories/setup/preview', {
			repository: repository.name,
			choices: binaryChoices(),
		});
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toContain(`release.yml: job ${name} already exists and is not a Beepboop binary build`);
	});
}

const unpinnedBuild = (name: string) => `  build-${name}:
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: kjanat/beepboop/actions/begin@v1
        id: beepboop
        with:
          execution-id: \${{ inputs.beepboop_execution_id }}
          stream: main
          operation: promote
      - uses: actions/checkout@v7
        with:
          ref: \${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}
          persist-credentials: false
      - run: make
`;
const unpinnedRelease = `name: Publish packages
run-name: \${{ inputs.beepboop_title || github.workflow }}
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id: { description: Beepboop execution, required: true, type: string }
      beepboop_title: { description: Beepboop run title, required: false, type: string }
jobs:
${unpinnedBuild('signer')}${unpinnedBuild('tool')}  publish:
    needs: [build-signer, build-tool]
    permissions: { contents: write, id-token: write, attestations: write }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: kjanat/beepboop/actions/begin@v1
        id: beepboop
        with:
          execution-id: \${{ inputs.beepboop_execution_id }}
          stream: main
          operation: promote
      - uses: actions/checkout@v7
        with:
          ref: \${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}
          persist-credentials: false
      - uses: actions/download-artifact@v8
        with: { path: dist, merge-multiple: true }
      - uses: anchore/sbom-action@v0
        with: { path: dist }
      - uses: actions/attest@v4
        with: { subject-checksums: dist/checksums.txt }
      - id: beepboop_binaries
        run: gh release upload "\${TAG}" -- *
      - uses: kjanat/beepboop/actions/publish-refs@v1
        with:
          token: \${{ github.token }}
      - uses: kjanat/beepboop/actions/publish-release@v1
        with:
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
      - uses: kjanat/beepboop/actions/report@v1
        if: \${{ !cancelled() && steps.beepboop.outcome == 'success' }}
        with:
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
          publications: "[]"
`;

test('setup moves OIDC out of earlier build jobs and pins their release steps', async () => {
	const repository = binaryRepository();
	world.github.push(repository, { '.github/workflows/release.yml': unpinnedRelease }, 'Integrate binary builds');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const { jobs } = binaryWorkflowSchema.parse(parse(after));
	expect(Object.keys(jobs)).toEqual(['begin', 'build-signer', 'build-tool', 'publish']);
	expect(jobs['build-signer']?.permissions).toEqual({ contents: 'read' });
	expect(jobs['build-tool']?.steps.some(step => step.uses?.includes('/actions/begin@'))).toBe(false);
	expect(jobs.publish?.steps.map(step => step.uses ?? step.id ?? step.name)).toEqual([
		'actions/checkout@v7',
		'kjanat/beepboop/actions/begin@v1',
		'actions/checkout@v7',
		pinned('download'),
		'Write checksums',
		pinned('sbom'),
		pinned('attest'),
		pinned('attest'),
		'beepboop_binaries',
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/publish-release@v1',
		'kjanat/beepboop/actions/report@v1',
	]);
	world.github.push(repository, { '.github/workflows/release.yml': after }, 'Regenerate binary builds');
	const rerun = await api('/api/repositories/setup/preview', { repository: repository.name, choices: binaryChoices() });
	const replanned = await Effect.runPromise(parseSetupPlan(rerun.body));
	expect(replanned.blockers).toEqual([]);
	expect(replanned.edits.find(edit => edit.path === '.github/workflows/release.yml')).toBeUndefined();
	const limits = (source: string) =>
		Object.fromEntries(
			Object.entries(
				z.object({ jobs: z.record(z.string(), z.looseObject({ 'timeout-minutes': z.number().optional() })) })
					.parse(parse(source)).jobs,
			).map(([name, job]) => [name, job['timeout-minutes']]),
		);
	expect(limits(after)).toEqual({ begin: 10, 'build-signer': 240, 'build-tool': 240, publish: publishMinutes(0) });
	const longer = parseDocument(after);
	longer.setIn(['jobs', 'build-tool', 'timeout-minutes'], 300);
	world.github.push(repository, { '.github/workflows/release.yml': longer.toString() }, 'Allow longer builds');
	const kept = await Effect.runPromise(
		parseSetupPlan(
			(await api('/api/repositories/setup/preview', { repository: repository.name, choices: binaryChoices() })).body,
		),
	);
	expect(kept.blockers).toEqual([]);
	expect(kept.edits.find(edit => edit.path === '.github/workflows/release.yml')).toBeUndefined();
});

test('binary builds upload their files before an existing ref publication', async () => {
	const repository = binaryRepository();
	const workflow = publishWorkflow.replace(
		'      - run: npm publish\n',
		'      - run: npm publish\n      - uses: kjanat/beepboop/actions/publish-refs@v1\n        with:\n          token: ${{ github.token }}\n',
	);
	world.github.push(repository, { '.github/workflows/release.yml': workflow }, 'Add a release workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const steps = binaryWorkflowSchema.parse(parse(after)).jobs.publish?.steps ?? [];
	const at = (match: (step: (typeof steps)[number]) => boolean) => steps.findIndex(match);
	expect(at(step => step.uses === 'kjanat/beepboop/actions/publish-refs@v1')).toBeGreaterThan(
		at(step => step.id === 'beepboop_binaries'),
	);
	expect(at(step => step.id === 'beepboop_binaries')).toBeGreaterThan(at(step => step.run === 'npm publish'));
});

test('binary builds belong to the publication job alone', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const choices = binaryChoices({ job: 'build-signer' });
	const promote = choices.streams[0]?.promote;
	if (!promote?.binaries) throw new Error('binary choices expected');
	choices.streams[0] = {
		...choices.streams[0],
		name: 'main',
		packages: [],
		required: [],
		versioning: 'workspace',
		prepare: {
			file: 'prepare.yml',
			job: 'prepare',
			triggers: 'review',
			commands: 'go test ./...',
			publicationSteps: {},
			binaries: promote.binaries,
		},
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('prepare.yml: binary builds belong to the publication workflow');
	expect(plan.blockers).toContain('release.yml: job build-signer conflicts with a binary build job');
});

test('setup preserves a configured workflow preparation strategy', async () => {
	const repository = widget(world.github);
	world.github.push(repository, {
		'.github/beepboop.json': widgetConfiguration().replace('"strategy": "managed"', '"strategy": "workflow"'),
	}, 'Delegate preparation to a workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('main: select a preparation workflow for the configured workflow strategy.');
});

test('adoption leaves custom checkout refs for explicit integration', async () => {
	const repository = widget(world.github, { configured: false });
	const workflow = publishWorkflow.replace(
		'    steps:\n',
		`    steps:
      - uses: actions/checkout@v7
        with:
          ref: another-branch
`,
	);
	world.github.push(repository, { '.github/workflows/publish.yml': workflow }, 'Use an explicit checkout ref');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('publish.yml: checkout the execution sourceSha after begin');
	expect(plan.edits.find(edit => edit.path === '.github/workflows/publish.yml')).toBeUndefined();
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(422);
	expect(repository.pulls).toHaveLength(0);
});

test('configuration-only adoption does not request workflow write permission', async () => {
	const repository = widget(world.github, { configured: false });
	const workflow = publishWorkflow.replace(
		'    steps:\n',
		`    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
`,
	).replace(
		'      - run: npm publish',
		`      - uses: actions/checkout@v7
        with:
          ref: \${{ fromJSON(steps.release.outputs.context).sourceSha }}
      - run: npm publish`,
	);
	world.github.push(repository, { '.github/workflows/publish.yml': workflow }, 'Complete the integration');
	world.network.serve('api.github.com', async request => {
		if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/access_tokens')) {
			const body = z.object({ permissions: z.record(z.string(), z.string()) }).parse(await request.clone().json());
			if (body.permissions.workflows === 'write') {
				return Response.json(
					{ message: 'The permissions requested are not granted to this installation' },
					{ status: 422 },
				);
			}
		}
		return world.github.handle(request);
	});
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
});

for (const inherited of [false, true]) {
	test(`separating workflows removes only the generated phase input (inherited=${inherited})`, async () => {
		const repository = widget(world.github, { configured: false });
		const policy = {
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					required: ['pkg:npm/widget'],
					prepare: {
						workflow: {
							file: 'release.yml',
							inputs: { beepboop_operation: 'prepare', channel: 'stable', dryRun: false },
						},
					},
					promote: {
						workflow: { file: 'release.yml', inputs: { beepboop_operation: 'publish', channel: 'stable', retries: 0 } },
					},
				},
			},
		};
		if (inherited) world.github.create('octo/presets', { 'release.json': JSON.stringify(policy) });
		world.github.push(repository, {
			'.github/beepboop.json': JSON.stringify(inherited ? { extends: ['github>octo/presets:release'] } : policy),
		}, 'Configure shared workflow inputs');
		const api = bearer(world, await world.cliSession());
		const choices = {
			streams: [{
				name: 'main',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				versioning: 'workspace',
				prepare: { file: 'prepare-release.yml', job: 'prepare', commands: 'npm install' },
				promote: { file: 'publish-release.yml', job: 'publish', commands: 'npm publish' },
			}],
		};
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		const binding = z.object({ file: z.string(), inputs: z.record(z.string(), z.unknown()) });
		const configuration = z.object({
			streams: z.object({
				main: z.object({
					prepare: z.object({ workflow: binding }),
					promote: z.object({ workflow: binding }),
				}),
			}),
		});
		const proposed = configuration.parse(
			JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
		);
		expect(proposed.streams.main.prepare.workflow.inputs).toEqual({ channel: 'stable', dryRun: false });
		expect(proposed.streams.main.promote.workflow.inputs).toEqual({ channel: 'stable', retries: 0 });
		expect(
			(await applySetup(api, repository.name, plan, plan.choices)).status,
		).toBe(200);
		world.github.merge(repository, 1);
		const discovered = await api('/api/repositories/discover', { repository: repository.name });
		expect(discovered.status).toBe(200);
		const resolved = configuration.parse(field(discovered.body, 'configuration'));
		expect(resolved.streams.main.prepare.workflow.inputs).toEqual({ channel: 'stable', dryRun: false });
		expect(resolved.streams.main.promote.workflow.inputs).toEqual({ channel: 'stable', retries: 0 });
	});
}

test('workflow input merging keeps shared phase inputs until the target file changes or explicitly overrides them', () => {
	const base = { file: 'release.yml', inputs: { beepboop_operation: 'prepare', retries: 0 } };
	const unchanged = mergeConfiguration(base, { file: 'release.yml', inputs: { dryRun: false } });
	if (Result.isFailure(unchanged)) throw unchanged.failure;
	expect(unchanged.success).toEqual({
		file: 'release.yml',
		inputs: { beepboop_operation: 'prepare', retries: 0, dryRun: false },
	});
	const explicit = mergeConfiguration(base, { file: 'custom.yml', inputs: { beepboop_operation: 'custom' } });
	if (Result.isFailure(explicit)) throw explicit.failure;
	expect(explicit.success).toEqual({ file: 'custom.yml', inputs: { beepboop_operation: 'custom', retries: 0 } });
	expect(base.inputs.beepboop_operation).toBe('prepare');
});

test('a merged binary workflow suggests its publication job for the promote role', async () => {
	const repository = binaryRepository();
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: binaryChoices(),
	});
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	world.github.push(
		repository,
		Object.fromEntries(plan.edits.map(edit => [edit.path, edit.after])),
		'Merge the setup proposal',
	);
	const suggested = await Effect.runPromise(parseSetupPlan(
		(await api('/api/repositories/setup/preview', { repository: repository.name })).body,
	));
	expect(suggested.workflows.find(workflow => workflow.file === 'release.yml')?.roles).toEqual([
		{ job: 'publish', stream: 'main', operation: 'promote' },
	]);
	expect(suggested.choices.streams[0]?.promote?.job).toBe('publish');
});

test('a refreshed crate setup publishes every selected crate in order, with a token, tags and a GitHub release', async () => {
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const repository = world.github.create('octo/sql', {
		'Cargo.toml':
			'[workspace]\nmembers = ["crates/*", "vendor/parser"]\n\n[workspace.package]\nversion = "0.1.0"\n\n[workspace.dependencies]\nparser = { package = "sql-parser", path = "vendor/parser", version = "0.1.0" }\nsql = { path = "crates/sql", version = "0.1.0" }\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/sql/Cargo.toml':
			'[package]\nname = "sql"\nversion.workspace = true\n\n[dependencies]\nparser = { workspace = true }\n',
		'crates/sql-cli/Cargo.toml':
			'[package]\nname = "sql-cli"\nversion.workspace = true\n\n[dependencies]\nsql = { workspace = true }\n',
		'vendor/parser/Cargo.toml': '[package]\nname = "sql-parser"\nversion.workspace = true\n',
	});
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const packages = ['pkg:cargo/sql', 'pkg:cargo/sql-cli', 'pkg:cargo/sql-parser'];
	const stale = cratePublishCommands(['sql', 'sql-cli']).split('\n').filter(line => !line.includes('GITHUB_OUTPUT'))
		.join('\n');
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages,
			required: packages,
			versioning: 'workspace',
			prepare: {
				file: 'release-sql.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo check --workspace --all-targets\ncargo test --workspace',
				publicationSteps: {},
			},
			promote: { file: 'release-sql.yml', job: 'publish', triggers: 'review', commands: stale, publicationSteps: {} },
		}],
	};
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(plan.blockers).toEqual([]);
	expect(plan.choices.streams[0]?.approval).toBe('push');
	expect(plan.choices.streams[0]?.promote?.credentials).toEqual({ CARGO_REGISTRY_TOKEN: 'crates-io' });
	const configuration = z.object({
		streams: z.object({
			main: z.object({
				credentials: z.array(z.string()),
				promote: z.object({ approval: z.string(), workflow: z.looseObject({ publications: z.array(z.string()) }) }),
			}),
		}),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.streams.main.credentials).toEqual(['crates-io']);
	expect(configuration.streams.main.promote.approval).toBe('push');
	expect(configuration.streams.main.promote.workflow).toMatchObject({
		refs: { phase: 'version', prefix: 'v' },
		publications: ['pkg:cargo/sql-cli', 'pkg:cargo/sql', 'pkg:cargo/sql-parser', 'github-release:octo/sql'],
	});
	const workflow = z.object({
		jobs: z.object({
			publish: z.object({
				steps: z.array(
					z.looseObject({
						id: z.string().optional(),
						uses: z.string().optional(),
						run: z.string().optional(),
						with: z.looseObject({ publications: z.string().optional() }).optional(),
					}),
				),
			}),
		}),
	}).parse(parse(plan.edits.find(edit => edit.path === '.github/workflows/release-sql.yml')?.after ?? ''));
	const steps = workflow.jobs.publish.steps;
	expect(plan.choices.streams[0]?.promote?.commands).toBe(ledgerCommand);
	expect(steps.find(step => step.id === 'beepboop_publish')).toMatchObject({
		uses: 'kjanat/beepboop/actions/publish@v1',
		with: { credentials: JSON.stringify({ CARGO_REGISTRY_TOKEN: 'crates-io' }) },
	});
	expect(steps.map(step => step.uses ?? step.id).filter(step => /publish-(?:refs|release)|report/.test(step ?? '')))
		.toEqual(['kjanat/beepboop/actions/publish-refs@v1', 'kjanat/beepboop/actions/publish-release@v1']);
	const identity = { '${{ insert }}': "${{ fromJSON(steps.beepboop_token.outputs.gitId || '{}') }}" };
	expect(steps.find(step => step.id === 'beepboop_refs')?.env).toEqual(identity);
	const generated = plan.edits.find(edit => edit.path === '.github/workflows/release-sql.yml')?.after ?? '';
	const timeouts = (source: string) => {
		const jobs = z.object({ jobs: z.record(z.string(), z.looseObject({ 'timeout-minutes': z.number().optional() })) })
			.parse(parse(source)).jobs;
		return [jobs.prepare?.['timeout-minutes'], jobs.publish?.['timeout-minutes']];
	};
	expect(timeouts(generated)).toEqual([120, publishMinutes(3)]);
	expect(publishMinutes(3)).toBe(210);
	const refsEnv = ['jobs', 'publish', 'steps', steps.findIndex(step => step.id === 'beepboop_refs'), 'env'];
	const strict = { '${{ insert }}': '${{ fromJSON(steps.beepboop_token.outputs.gitId) }}', LANG: 'C' };
	for (const env of [undefined, strict]) {
		const kept = parseDocument(generated);
		if (env) {
			kept.setIn(refsEnv, env);
			kept.setIn(['jobs', 'publish', 'timeout-minutes'], 90);
		} else {
			kept.deleteIn(refsEnv);
			kept.deleteIn(['jobs', 'publish', 'timeout-minutes']);
		}
		world.github.push(repository, { '.github/workflows/release-sql.yml': kept.toString() }, 'Change the tag identity');
		const repaired = await Effect.runPromise(
			parseSetupPlan(
				(await api('/api/repositories/setup/preview', { repository: repository.name, choices: plan.choices })).body,
			),
		);
		expect(repaired.blockers).toEqual([]);
		const after = repaired.edits.find(edit => edit.path === '.github/workflows/release-sql.yml')?.after ?? '';
		const repairedSteps = z.object({
			jobs: z.object({ publish: z.object({ steps: z.array(z.looseObject({ id: z.string().optional() })) }) }),
		}).parse(parse(after)).jobs.publish.steps;
		expect(repairedSteps.find(step => step.id === 'beepboop_refs')?.env).toEqual(
			env ? { LANG: 'C', ...identity } : identity,
		);
		expect(timeouts(after)).toEqual([120, env ? 90 : 210]);
	}
	const without = structuredClone(choices);
	const stream = without.streams[0];
	if (!stream) throw new Error('stream expected');
	stream.packages = ['pkg:cargo/sql', 'pkg:cargo/sql-cli'];
	stream.required = ['pkg:cargo/sql', 'pkg:cargo/sql-cli'];
	const partial = await Effect.runPromise(
		parseSetupPlan(
			(await api('/api/repositories/setup/preview', { repository: repository.name, choices: without })).body,
		),
	);
	expect(partial.blockers).toEqual([]);
	expect(partial.choices.streams[0]?.packages).toEqual(stream.packages);
	expect(partial.notes).toContain(
		'main: a selected package depends on `sql-parser` on crates.io, and its registry does not have this version. Publish it first.',
	);
	expect(partial.choices.streams[0]?.promote?.commands).toBe(ledgerCommand);
});

test('an unticked dependency in the setup PR body stays unticked through edits and refreshes', async () => {
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const repository = world.github.create('octo/sql', {
		'Cargo.toml':
			'[workspace]\nmembers = ["crates/*", "vendor/parser"]\n\n[workspace.package]\nversion = "0.1.0"\n\n[workspace.dependencies]\nparser = { package = "sql-parser", path = "vendor/parser", version = "0.1.0" }\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/sql/Cargo.toml':
			'[package]\nname = "sql"\nversion.workspace = true\n\n[dependencies]\nparser = { workspace = true }\n',
		'vendor/parser/Cargo.toml': '[package]\nname = "sql-parser"\nversion.workspace = true\n',
	});
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const packages = ['pkg:cargo/sql', 'pkg:cargo/sql-parser'];
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages,
			required: packages,
			versioning: 'workspace',
			prepare: {
				file: 'release-sql.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo test --workspace',
				publicationSteps: {},
			},
			promote: {
				file: 'release-sql.yml',
				job: 'publish',
				triggers: 'review',
				commands: cratePublishCommands(['sql-parser', 'sql']),
				publicationSteps: {},
			},
		}],
	};
	const proposal = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(proposal.blockers).toEqual([]);
	const applied = await applySetup(api, repository.name, proposal, proposal.choices);
	expect(applied.status).toBe(200);
	const pull = repository.pulls[0];
	if (!pull) throw new Error('No setup pull request');
	const box = /- \[[ x]\] (<!-- beepboop:choice:package:main:pkg%3Acargo%2Fsql%2Dparser -->)/;
	expect(pull.body).toMatch(/- \[x\] <!-- beepboop:choice:package:main:pkg%3Acargo%2Fsql%2Dparser -->/);
	const before = pull.body;
	expect(before.startsWith('<!-- beepboop:setup:start -->\n')).toBe(true);
	expect(before.endsWith('\n<!-- beepboop:setup:end -->\n')).toBe(true);
	const unticked = `Written above.\n\n${before.replace(box, '- [ ] $1')}\nCloses #26\n`;
	const framed = (body: string) =>
		body.startsWith('Written above.\n\n<!-- beepboop:setup:start -->\n')
		&& body.endsWith('\n<!-- beepboop:setup:end -->\n\nCloses #26\n');
	await editPull(world, repository, pull, unticked);
	await world.wait(1_000);
	expect(pull.body).toContain(
		'<!-- beepboop:setup-status -->\nBeepboop is rebuilding the proposal from your edit.\n<!-- /beepboop:setup-status -->',
	);
	expect(framed(pull.body)).toBe(true);
	await world.wait(7_000);
	expect(pull.body).not.toContain('Beepboop is rebuilding the proposal from your edit.');
	expect(framed(pull.body)).toBe(true);
	const untickedBox = /- \[ \] <!-- beepboop:choice:package:main:pkg%3Acargo%2Fsql%2Dparser -->/;
	expect(configured(repository, 'automation/onboarding')).toEqual(['pkg:cargo/sql']);
	expect(pull.body).toMatch(untickedBox);
	expect(pull.body).toContain(
		'main: a selected package depends on `sql-parser` on crates.io, and its registry does not have this version. Publish it first.',
	);
	world.github.push(repository, { 'README.md': '# sql\n' }, 'Add a readme');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(configured(repository, 'automation/onboarding')).toEqual(['pkg:cargo/sql']);
	expect(pull.body).toMatch(untickedBox);
	expect(framed(pull.body)).toBe(true);
	world.github.push(repository, { 'README.md': '# sql\n\nUsage.\n' }, 'Document usage');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(pull.body).toMatch(untickedBox);
	expect(framed(pull.body)).toBe(true);
});

test('a setup PR body from before the markers keeps the lines its owner added', async () => {
	const { repository, api, pull } = await gadgetSetup();
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const legacy = pull.body.replace('<!-- beepboop:setup:start -->\n', '').replace('\n<!-- beepboop:setup:end -->', '');
	pull.edits = [{ editor: 'beepboop-test', body: legacy }];
	pull.body = `Closes #26\n\n${legacy.replace('Change versioning', 'Owner note.\n\nChange versioning')}`;
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(pull.body.startsWith('<!-- beepboop:setup:start -->\n')).toBe(true);
	expect(pull.body.endsWith('\n<!-- beepboop:setup:end -->\n\nCloses #26\n\nOwner note.\n')).toBe(true);
});

test('a saved crate script becomes beepboop publish', async () => {
	const repository = world.github.create('octo/mixed', {
		'Cargo.toml': '[package]\nname = "mixed-cli"\nversion = "1.0.0"\nedition = "2024"\n',
		'js/package.json': '{"name":"mixed-js","version":"1.0.0"}',
	});
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const promote = (packages: string[]) => ({
		streams: [{
			name: 'main',
			packages,
			required: packages,
			versioning: 'workspace' as const,
			promote: {
				file: 'release-mixed.yml',
				triggers: 'review' as const,
				commands: cratePublishCommands(['mixed-cli']),
				publicationSteps: {},
			},
		}],
	});
	const preview = async (choices: SetupChoices) =>
		Effect.runPromise(
			parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
		);
	const crates = await preview(promote(['pkg:cargo/mixed-cli']));
	expect(crates.choices.streams[0]?.promote?.commands).toBe(ledgerCommand);
	const mixed = await preview(promote(['pkg:cargo/mixed-cli', 'pkg:npm/mixed-js']));
	expect(mixed.choices.streams[0]?.promote?.commands).toBe(ledgerCommand);
});

async function gadgetSetup() {
	const repository = widget(world.github, { configured: false });
	world.github.push(
		repository,
		{ 'packages/gadget/package.json': '{"name":"gadget","version":"1.0.0"}' },
		'Add gadget',
	);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: {
				file: 'release.yml',
				job: 'promote',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
			},
		}],
	};
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	const pull = repository.pulls[0];
	if (!pull) throw new Error('No setup pull request');
	return { repository, api, pull };
}
const configured = (repository: Parameters<typeof world.github.file>[0], ref: string) =>
	z.object({ streams: z.object({ main: z.object({ packages: z.array(z.string()) }) }) }).parse(
		JSON.parse(world.github.file(repository, '.github/beepboop.json', ref) ?? '{}'),
	).streams.main.packages;

test('a body edit ticks a package that the saved options from an older discovery did not offer', async () => {
	const { repository, pull } = await gadgetSetup();
	const row = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repository.id).first(),
	);
	const saved = z.looseObject({ options: z.array(z.looseObject({ kind: z.string(), package: z.string().optional() })) })
		.parse(JSON.parse(row.document));
	saved.options = saved.options.filter(option => option.package !== 'pkg:npm/gadget');
	await world.db.prepare('UPDATE onboarding SET document=? WHERE repository_id=?').bind(
		JSON.stringify(saved),
		repository.id,
	).run();
	const ticked = pull.body.replace(
		/- \[ \] (<!-- beepboop:choice:package:main:pkg%3Anpm%2Fgadget -->)/,
		'- [x] $1',
	);
	expect(ticked).not.toBe(pull.body);
	await editPull(world, repository, pull, ticked);
	await world.wait(8_000);
	expect(configured(repository, 'automation/onboarding')).toEqual(['pkg:npm/widget', 'pkg:npm/gadget']);
});

test('the rebuilding status replaces the settled line once', () => {
	const section = (status: string) =>
		`Proposal\n\n<!-- beepboop:setup-status -->\n${status}\n<!-- /beepboop:setup-status -->`;
	const rebuilding = 'Inspected abc.\n\nBeepboop is rebuilding the proposal from your edit.';
	expect(rebuildingStatus(section('Inspected abc.\n\nThe proposal is up to date.'))).toBe(rebuilding);
	expect(rebuildingStatus(section(rebuilding))).toBe(rebuilding);
	expect(rebuildingStatus('Proposal')).toBe('Beepboop is rebuilding the proposal from your edit.');
});

test('a setup update describes each changed file', () => {
	const workflow = (publishStep: string, timeout: string) =>
		`jobs:\n  publish:\n${timeout}    steps:\n      - uses: actions/checkout@v7\n${publishStep}  old:\n    steps: []\n`;
	const before = workflow(
		'      - id: beepboop_refs\n        uses: kjanat/beepboop/actions/publish-refs@v1\n        env:\n          "${{ insert }}": ${{ fromJSON(steps.beepboop_token.outputs.gitId) }}\n      - run: echo done\n',
		'',
	);
	const after = workflow(
		'      - id: beepboop_refs\n        uses: kjanat/beepboop/actions/publish-refs@v1\n        env:\n          "${{ insert }}": ${{ fromJSON(steps.beepboop_token.outputs.gitId || \'{}\') }}\n      - id: beepboop_token\n        uses: kjanat/beepboop/actions/token@v2\n',
		'    timeout-minutes: 90\n',
	).replace('  old:\n    steps: []\n', '  new:\n    steps: []\n');
	const edits = [
		{ path: '.github/workflows/release.yml', before, after },
		{
			path: '.github/beepboop.json',
			before: '{"streams":{"main":{"packages":[]}}}',
			after: '{"streams":{"main":{"packages":["a"]}}}',
		},
		{ path: '.github/workflows/prepare.yml', before: '', after: 'jobs: {}\n' },
	];
	expect(describeEdits(edits)).toEqual([
		{
			path: '.github/workflows/release.yml',
			changes: [
				{ text: 'job `publish`: sets `timeout-minutes` to 90, which stops a hung run', label: 'job timeouts' },
				{
					text:
						"job `publish`, step `beepboop_refs`: inserts the token step's gitId with a fallback for a skipped token step",
					label: 'gitId fallback',
				},
				{ text: 'job `publish`: adds step `beepboop_token`' },
				{ text: 'job `publish`: removes step `echo done`' },
				{ text: 'adds job `new`' },
				{ text: 'removes job `old`' },
			],
		},
		{
			path: '.github/beepboop.json',
			changes: [{ text: 'changes `streams.main.packages`', label: 'release configuration' }],
		},
		{ path: '.github/workflows/prepare.yml', changes: [{ text: 'adds the file' }] },
	]);
	expect(setupTitle('automation/setup-update', edits)).toBe('chore: update release setup');
	expect(setupTitle('automation/setup-update', edits.slice(0, 1))).toBe(
		'chore: update release setup (job timeouts, gitId fallback)',
	);
	expect(setupTitle('automation/setup-update', edits.slice(2))).toBe('chore: update release setup');
	expect(setupTitle('automation/onboarding', edits)).toBe('chore: configure release automation');
	const uses = describeEdits([{
		path: '.github/workflows/x.yml',
		before: 'jobs:\n  a:\n    steps:\n      - id: s\n        uses: o/a@v1\n',
		after: 'jobs:\n  a:\n    steps:\n      - id: s\n        uses: o/a@v2\n',
	}]);
	expect(uses[0]?.changes).toEqual([{ text: 'job `a`, step `s`: uses `o/a@v2`', label: 'action references' }]);
	const step = (fields: string) => `jobs:\n  a:\n    steps:\n      - id: s\n${fields}      - id: t\n`;
	expect(describeEdits([
		{ path: 'a.yml', before: 'on: push\njobs: {}\n', after: 'on: workflow_dispatch\njobs: {}\n' },
		{
			path: 'b.yml',
			before: 'jobs:\n  a:\n    timeout-minutes: 5\n    env: {}\n',
			after: 'jobs:\n  a:\n    if: true\n',
		},
		{ path: 'c.yml', before: step('        run: x\n'), after: step('        run: y\n        shell: bash\n') },
		{
			path: 'd.yml',
			before: 'jobs:\n  a:\n    steps:\n      - id: s\n      - id: t\n',
			after: 'jobs:\n  a:\n    steps:\n      - id: t\n      - id: s\n',
		},
		{ path: 'e.yml', before: 'jobs: {}\n', after: 'jobs: {}\n\n' },
		{ path: 'f.yml', before: 'a: [', after: 'a: 1\n' },
		{ path: 'g.json', before: '{"a":1,"b":2}', after: '{"b":2,"c":3}' },
	])).toEqual([
		{ path: 'a.yml', changes: [{ text: 'changes `on`' }] },
		{
			path: 'b.yml',
			changes: [
				{ text: 'job `a`: removes `timeout-minutes`, which stops a hung run', label: 'job timeouts' },
				{ text: 'job `a`: removes `env`' },
				{ text: 'job `a`: adds `if`' },
			],
		},
		{ path: 'c.yml', changes: [{ text: 'job `a`, step `s`: changes `run`, `shell`' }] },
		{ path: 'd.yml', changes: [{ text: 'job `a`: reorders its steps' }] },
		{ path: 'e.yml', changes: [{ text: 'changes formatting' }] },
		{ path: 'f.yml', changes: [{ text: 'changes the file' }] },
		{
			path: 'g.json',
			changes: [
				{ text: 'removes `a`', label: 'release configuration' },
				{ text: 'adds `c`', label: 'release configuration' },
			],
		},
	]);
});

test('a setup update gets its own branch, a title naming its changes and a change list', async () => {
	const { repository, api, pull } = await gadgetSetup();
	expect([pull.head.ref, pull.title]).toEqual(['automation/onboarding', 'chore: configure release automation']);
	const merged = world.github.merge(repository, pull.number);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const file = '.github/workflows/release.yml';
	const workflow = parseDocument(world.github.file(repository, file, merged.sha) ?? '');
	expect(workflow.getIn(['jobs', 'promote', 'timeout-minutes'])).toBe(publishMinutes(1));
	workflow.deleteIn(['jobs', 'promote', 'timeout-minutes']);
	world.github.push(repository, { [file]: workflow.toString() }, 'Drop the job timeout');
	const plan = await discoverSetup(api, repository.name);
	expect([plan.blockers, plan.edits.map(edit => edit.path)]).toEqual([[], [file]]);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	const update = repository.pulls.find(entry => entry.state === 'open');
	if (!update) throw new Error('No setup update pull request');
	const expected = [
		'automation/setup-update',
		'chore: update release setup (job timeouts)',
		`<!-- beepboop:setup:start -->\nChanges against the release setup on \`main\`:\n\n- \`${file}\`\n  - job \`promote\`: sets \`timeout-minutes\` to ${
			publishMinutes(1)
		}, which stops a hung run\n\nConfigure releases`,
	];
	expect([update.head.ref, update.title, update.body.slice(0, expected[2]?.length)]).toEqual(expected);
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the default branch');
	const head = update.head.sha;
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(update.head.sha).not.toBe(head);
	expect([update.head.ref, update.title, update.body.slice(0, expected[2]?.length)]).toEqual(expected);
	expect(repository.pulls.filter(entry => entry.state === 'open')).toEqual([update]);
});

test('a setup rebuild keeps a ticked Release after merge box', async () => {
	const { repository, api, pull } = await gadgetSetup();
	const box = '<!-- beepboop:release-after-merge --> Release after merge';
	expect(pull.body).toContain(`- [ ] ${box}`);
	pull.body = pull.body.replace(`- [ ] ${box}`, `- [x] ${box}`);
	const head = pull.head.sha;
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the default branch');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(pull.head.sha).not.toBe(head);
	expect(pull.body).toContain(`- [x] ${box}`);
});

test('a refresh that started before a newer setup edit neither pushes nor rewrites the PR', async () => {
	const { repository, api, pull } = await gadgetSetup();
	const head = pull.head.sha, body = pull.body;
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the default branch');
	world.network.serve('api.github.com', async request => {
		if (new URL(request.url).pathname.includes('/rules/branches/')) {
			await world.db.prepare("UPDATE onboarding SET document=json_set(document, '$.edit', 1) WHERE repository_id=?")
				.bind(repository.id).run();
		}
		return world.github.handle(request);
	});
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(pull.head.sha).toBe(head);
	expect(world.github.resolve(repository, 'automation/onboarding').sha).toBe(head);
	expect(pull.body).toBe(body);
	const audits = await world.db.prepare('SELECT action FROM audit WHERE action LIKE ?').bind('repository.setup.%')
		.all();
	expect(z.array(z.object({ action: z.string() })).parse(audits.results).map(row => row.action)).toEqual([]);
});
