import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Effect, Result } from 'effect';
import { parse, parseDocument } from 'yaml';
import { z } from 'zod';
import { mergeConfiguration } from '@/automation/configuration';
import { pinned } from '@/automation/setup-actions';
import { suggestedCommands } from '@/automation/setup-defaults';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import { bearer, field } from '@root/test/support/http.ts';
import { publishWorkflow, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

const checkout = pinned('checkout');
let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
	const refreshed = await api('/api/repositories/setup/preview', { repository: repository.name });
	expect(refreshed.status).toBe(200);
	const next = await Effect.runPromise(parseSetupPlan(refreshed.body));
	expect(next.blockers).toEqual([]);
	expect(next.choices).toEqual(choices);
	const reapplied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: next.choices,
		planId: next.planId,
		sourceSha: next.sourceSha,
		setupHead: next.setupHead,
	});
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
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
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
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
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
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
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
		(await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: setup.choices,
			planId: setup.planId,
			sourceSha: setup.sourceSha,
			setupHead: setup.setupHead,
		})).status,
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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
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
	expect(suggestedCommands('promote', { name: 'main', packages: [widgetPackage] }, plan)).toBe('npm publish');
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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
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
		'release-widget.yml: grant npm-token with `beepboop secrets grant octo/widget npm-token --operation promote`.',
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
	expect(steps.slice(-4).map(step => step.uses ?? step.id)).toEqual([
		'beepboop_publish',
		'kjanat/beepboop/actions/token@v1',
		'kjanat/beepboop/actions/publish-refs@v1',
		'kjanat/beepboop/actions/report@v1',
	]);
	expect(steps.at(-3)).toEqual({
		id: 'beepboop_token',
		uses: 'kjanat/beepboop/actions/token@v1',
		with: { 'execution-id': '${{ steps.beepboop.outputs.execution-id }}', 'permission-contents': 'write' },
	});
	expect(steps.at(-2)?.with).toEqual({ token: '${{ steps.beepboop_token.outputs.token }}' });
	const configuration = z.object({
		streams: z.record(z.string(), z.object({ promote: z.object({ workflow: z.record(z.string(), z.unknown()) }) })),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configuration.streams.main?.promote.workflow.refs).toEqual({ phase: 'version', prefix: 'widget-v' });
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
});

test('binary builds refuse ref publication that runs before the upload', async () => {
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
	expect(plan.blockers).toContain(
		'release.yml: publish-refs and publish-release need to follow the binary upload; remove them before setup',
	);
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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(422);
	expect(repository.pulls).toHaveLength(0);
});

test('configuration-only adoption does not request workflow write permission', async () => {
	const repository = widget(world.github, { configured: false });
	const workflow = publishWorkflow.replace(
		'    steps:\n',
		`    steps:
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
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
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
			(await api('/api/repositories/setup/apply', {
				repository: repository.name,
				choices: plan.choices,
				planId: plan.planId,
				sourceSha: plan.sourceSha,
				setupHead: plan.setupHead,
			})).status,
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
