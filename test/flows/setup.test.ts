import { describe, expect, test } from 'bun:test';
import { bearer, field } from '@root/test/support/http.ts';
import {
	jsonFile,
	licenseText,
	npmManifest,
	publishWorkflow,
	widget,
	widgetConfiguration,
} from '@root/test/support/repositories.ts';
import { applySetup, discoverSetup, editPull } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Result, Schema, Struct } from 'effect';
import { parse, parseDocument } from 'yaml';
import { mergeConfiguration } from '@/automation/configuration';
import { bodyChoices, releaseAfterMerge, setupBody, setupOptions } from '@/automation/setup';
import { pinned } from '@/automation/setup-actions';
import {
	behaviourChanges,
	changeDetails,
	describeEdits,
	onboardingBranch,
	setupTitle,
	updateBranch,
} from '@/automation/setup-changes';
import { cratePublishCommands, ledgerCommand, suggestedCommands } from '@/automation/setup-defaults';
import { rebuildingStatus } from '@/automation/setup-maintenance';
import { parseSetupPlan } from '@/automation/setup-plan';
import { streamSummary } from '@/automation/setup-summary';
import type { SetupChoices, SetupPlan } from '@/automation/setup-types';
import { publishMinutes } from '@/automation/setup-workflows';
import { setupChoicesSchema } from '@/contract/setup';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';

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

const workflowSchema = mutableStruct({
	jobs: mutableStruct({
		publish: mutableStruct({
			steps: mutableArray(mutableStruct({
				uses: Schema.optional(Schema.String),
				run: Schema.optional(Schema.String),
				id: Schema.optional(Schema.String),
				with: Schema.optional(mutableRecord(Schema.String, Schema.Unknown)),
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
		const steps = decodeSync(workflowSchema, parse(edit?.after ?? '')).jobs.publish.steps;
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
	const steps = decodeSync(workflowSchema, parse(edit?.after ?? '')).jobs.publish.steps;
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
	const { jobs } = decodeSync(binaryWorkflowSchema, parse(after));
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
			'publish.yml: steps before begin need explicit integration; prepare dependencies and build output after the planned checkout',
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

const binaryWorkflowSchema = mutableStruct({
	jobs: mutableRecord(
		Schema.String,
		mutableStruct({
			'runs-on': Schema.String,
			needs: Schema.optional(mutableArray(Schema.String)),
			permissions: Schema.optional(mutableRecord(Schema.String, Schema.String)),
			outputs: Schema.optional(mutableRecord(Schema.String, Schema.String)),
			strategy: Schema.optional(
				mutableStruct({
					matrix: mutableStruct({ include: mutableArray(mutableRecord(Schema.String, Schema.String)) }),
				}),
			),
			steps: mutableArray(mutableStruct({
				uses: Schema.optional(Schema.String),
				run: Schema.optional(Schema.String),
				id: Schema.optional(Schema.String),
				name: Schema.optional(Schema.String),
				env: Schema.optional(mutableRecord(Schema.String, Schema.String)),
				with: Schema.optional(mutableRecord(Schema.String, Schema.Unknown)),
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
	const { jobs } = decodeSync(binaryWorkflowSchema, parse(edit?.after ?? ''));
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
	expect(jobs['build-signer']?.['runs-on']).toBe('ubuntu-26.04');
	expect(jobs['build-signer']?.strategy?.matrix.include).toEqual([
		{ goos: 'linux', goarch: 'amd64', asset: 'signer-linux-amd64' },
		{ goos: 'darwin', goarch: 'arm64', asset: 'signer-darwin-arm64' },
		{ goos: 'windows', goarch: 'amd64', asset: 'signer-windows-amd64.exe' },
	]);
	expect(jobs['build-tool']?.['runs-on']).toBe('${{ matrix.runner }}');
	expect(jobs['build-tool']?.strategy?.matrix.include).toEqual([
		{ runner: 'ubuntu-26.04', target: 'x86_64-unknown-linux-gnu', ext: '', asset: 'tool-x86_64-unknown-linux-gnu' },
		{ runner: 'macos-26', target: 'aarch64-apple-darwin', ext: '', asset: 'tool-aarch64-apple-darwin' },
		{
			runner: 'windows-2025-vs2026',
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
	expect(jobs['build-signer']?.steps.some(step => step.uses === pinned('install'))).toBe(false);
	expect(jobs['build-tool']?.steps[1]).toEqual({
		uses: pinned('install'),
		with: { tool: 'cargo-auditable@0.7.7', fallback: 'none' },
	});
	expect(jobs['build-tool']?.steps.find(step => step.name === 'Build tool')?.run).toContain(
		'cargo auditable build --manifest-path "${MANIFEST}" --release --locked --bin "${BINARY}" --target "${TARGET}"\n',
	);
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
	const sbomStep = jobs.publish?.steps.find(step => step.uses === pinned('sbom'));
	expect(sbomStep?.with).toEqual({
		path: 'dist',
		format: 'spdx-json',
		'output-file': `dist/${sbom}.spdx.json`,
		'upload-artifact': false,
		'upload-release-assets': false,
	});
	expect(sbomStep?.env).toEqual({
		SYFT_SOURCE_NAME: sbom,
		SYFT_SOURCE_VERSION: '${{ fromJSON(steps.beepboop.outputs.context).version }}',
		SYFT_FILE_METADATA_SELECTION: 'all',
		SYFT_SELECT_CATALOGERS: '-pe-package',
	});
	expect(jobs.publish?.steps.filter(step => step.uses === pinned('attest')).map(step => step.with)).toEqual([
		{ 'subject-checksums': 'dist/checksums.txt' },
		{ 'subject-checksums': 'dist/checksums.txt', 'sbom-path': `dist/${sbom}.spdx.json` },
	]);
	const configuration = decodeSync(
		mutableStruct({
			managers: mutableArray(Schema.String),
			streams: mutableRecord(
				Schema.String,
				mutableStruct({ promote: mutableStruct({ workflow: mutableRecord(Schema.String, Schema.Unknown) }) }),
			),
		}),
		JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
	);
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
	const { jobs } = decodeSync(binaryWorkflowSchema, parse(after));
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
	expect(Object.keys(decodeSync(binaryWorkflowSchema, parse(after)).jobs)).toEqual([
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
	const configuration = decodeSync(
		mutableStruct({
			streams: mutableRecord(
				Schema.String,
				mutableStruct({ versionFiles: mutableArray(mutableRecord(Schema.String, Schema.Unknown)) }),
			),
		}),
		JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
	);
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
	const steps = decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? [];
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
	const configuration = decodeSync(
		mutableStruct({
			streams: mutableRecord(Schema.String, mutableStruct({ credentials: mutableArray(Schema.String) })),
		}),
		JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
	);
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
	const report = decodeSync(binaryWorkflowSchema, parse(release)).jobs.publish?.steps.find(step =>
		step.with?.publications
	);
	const publications = decodeSync(
		mutableArray(mutableStruct({ id: Schema.String, outcome: Schema.String })),
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

for (const [file, content] of [['mise.toml', '[tools]\nnode = "24"\n'], ['.tool-versions', 'nodejs 24\n']] as const) {
	test(`setup installs the mise toolchain from ${file} before the setup commands`, async () => {
		const repository = widget(world.github, { configured: false });
		const api = bearer(world, await world.cliSession());
		const choices = credentialChoices('release-widget.yml', 'npm publish');
		const stepsOf = async () => {
			const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
			const plan = await Effect.runPromise(parseSetupPlan(preview.body));
			expect(plan.blockers).toEqual([]);
			const after = plan.edits.find(edit => edit.path === '.github/workflows/release-widget.yml')?.after ?? '';
			return (decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? []).map(step =>
				step.uses ?? step.id
			);
		};
		expect(await stepsOf()).not.toContain(pinned('mise'));
		world.github.push(repository, { [file]: content }, 'Pin the toolchain');
		const steps = await stepsOf();
		expect(steps.slice(steps.indexOf(pinned('mise')), steps.indexOf('beepboop_publish') + 1)).toEqual([
			pinned('mise'),
			'kjanat/beepboop/actions/credentials@v1',
			'beepboop_publish',
		]);
	});
}

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
	const steps = decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? [];
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
	const configuration = decodeSync(
		mutableStruct({
			streams: mutableRecord(
				Schema.String,
				mutableStruct({ promote: mutableStruct({ workflow: mutableRecord(Schema.String, Schema.Unknown) }) }),
			),
		}),
		JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
	);
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
	const steps = decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? [];
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
	const steps = decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? [];
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
	const { jobs } = decodeSync(binaryWorkflowSchema, parse(after));
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
				decodeSync(
					mutableStruct({
						jobs: mutableRecord(Schema.String, looseStruct({ 'timeout-minutes': Schema.optional(Schema.Finite) })),
					}),
					parse(source),
				).jobs,
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
	const steps = decodeSync(binaryWorkflowSchema, parse(after)).jobs.publish?.steps ?? [];
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

test('setup names existingTriggers when a workflow Beepboop dispatches also runs on tags', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/publish.yml': publishWorkflow.replace('on:\n', "on:\n  push:\n    tags: ['v*']\n"),
	}, 'Publish on tags');
	const api = bearer(world, await world.cliSession());
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: { file: 'publish.yml', job: 'publish', triggers: 'review', commands: '', publicationSteps: {} },
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain(
		'publish.yml: set existingTriggers to replace-with-dispatch to hand publication control to Beepboop; preserving automatic publication requires a separate workflow',
	);
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
			const body = decodeSync(
				mutableStruct({ permissions: mutableRecord(Schema.String, Schema.String) }),
				await request.clone().json(),
			);
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
		const binding = mutableStruct({ file: Schema.String, inputs: mutableRecord(Schema.String, Schema.Unknown) });
		const configuration = mutableStruct({
			streams: mutableStruct({
				main: mutableStruct({
					prepare: mutableStruct({ workflow: binding }),
					promote: mutableStruct({ workflow: binding }),
				}),
			}),
		});
		const proposed = decodeSync(
			configuration,
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
		const resolved = decodeSync(configuration, field(discovered.body, 'configuration'));
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

test('an operation workflow holding plain crate lines is regenerated like the promote workflow', async () => {
	const repository = world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.1.0"\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml': '[package]\nname = "lint"\nversion.workspace = true\n',
	});
	const api = bearer(world, await world.cliSession());
	const crates = ['pkg:cargo/lint-core', 'pkg:cargo/lint'];
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: crates,
			required: crates,
			versioning: 'workspace',
			prepare: {
				file: 'prepare-lint.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo check --workspace --all-targets\ncargo test --workspace',
				publicationSteps: {},
			},
			promote: { file: 'release-lint.yml', job: 'publish', triggers: 'review', commands: '', publicationSteps: {} },
			operations: [{
				name: 'crates',
				file: 'publish-crates.yml',
				job: 'crates',
				triggers: 'review',
				commands: "cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint'",
				publicationSteps: {},
				needs: ['promote'],
				publications: crates,
			}],
		}],
	};
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(plan.blockers).toEqual([]);
	const operation = plan.choices.streams[0]?.operations?.[0];
	expect([operation?.commands, operation?.credentials]).toEqual([ledgerCommand, { CARGO_REGISTRY_TOKEN: 'crates-io' }]);
	const workflow = plan.edits.find(edit => edit.path === '.github/workflows/publish-crates.yml')?.after ?? '';
	expect(workflow).toContain('kjanat/beepboop/actions/publish@v1');
	expect(workflow).not.toContain('cargo publish');
});

const lintCrates = ['pkg:cargo/lint-core', 'pkg:cargo/lint'];
const plainLines = "cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint'";
const lintChoices = (commands: string): SetupChoices => ({
	streams: [{
		name: 'main',
		packages: lintCrates,
		required: lintCrates,
		versioning: 'workspace',
		prepare: {
			file: 'prepare-lint.yml',
			job: 'prepare',
			triggers: 'review',
			commands: 'cargo check --workspace --all-targets\ncargo test --workspace',
			publicationSteps: {},
		},
		promote: { file: 'release-lint.yml', job: 'publish', triggers: 'review', commands: '', publicationSteps: {} },
		operations: [{
			name: 'crates',
			file: 'publish-crates.yml',
			job: 'crates',
			triggers: 'review',
			commands,
			publicationSteps: {},
			needs: ['promote'],
			publications: lintCrates,
		}],
	}],
});
const lintRepository = () =>
	world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.1.0"\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml': '[package]\nname = "lint"\nversion.workspace = true\n',
	});

type PlainVariant = {
	publishIf?: string;
	publishKeys?: string;
	publishEnv?: string;
	reportWith?: string;
	publications?: string;
	untouched?: string;
	envAnchor?: boolean;
	ending?: string;
	earlier?: string;
	later?: string;
	reportKeys?: string;
	jobOutputs?: string;
};
const rewrittenPlain = async (variant: PlainVariant = {}) => {
	const repository = lintRepository();
	const api = bearer(world, await world.cliSession());
	const generated = await Effect.runPromise(
		parseSetupPlan(
			(await api('/api/repositories/setup/preview', {
				repository: repository.name,
				choices: lintChoices(ledgerCommand),
			}))
				.body,
		),
	);
	const ledger = generated.edits.find(edit => edit.path === '.github/workflows/publish-crates.yml')?.after ?? '';
	expect(ledger).toContain('kjanat/beepboop/actions/publish@');
	const plainWorkflow = ledger.replace(
		/ {6}- id: beepboop_publish\n {8}name: Publish selected packages\n {8}uses: [^\n]+\n {8}with:\n(?: {10}[^\n]+\n)+/,
		`${variant.earlier ? `      - ${variant.earlier}\n` : ''}      - id: beepboop_credentials
        uses: kjanat/beepboop/actions/credentials@v1
        with:
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
          aliases: '["crates-io"]'
      - id: beepboop_publish
        name: Publish selected packages
${variant.publishIf ? `        if: ${variant.publishIf}\n` : ''}${variant.publishKeys ?? ''}        run: |
          cargo publish --locked --package 'lint-core'
          cargo publish --locked --package 'lint'
        env:${variant.envAnchor ? ' &publish_env' : ''}
${
	variant.publishEnv
		?? ''
}          CARGO_REGISTRY_TOKEN: \${{ fromJSON(steps.beepboop_credentials.outputs.values)['crates-io'] }}
      - uses: kjanat/beepboop/actions/report@v1
${variant.reportKeys ?? ''}        if: \${{ !cancelled() && steps.beepboop.outcome == 'success' }}
        with:
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
${variant.reportWith ?? ''}          publications: ${
	variant.publications?.concat('\n') ?? `|
            [
              {
                "id": "pkg:cargo/lint-core",
                "manager": "cargo",
                "name": "lint-core",
                "version": "\${{ fromJSON(steps.beepboop.outputs.context).version }}",
                "required": true,
                "outcome": "\${{ steps.beepboop_publish.outcome == 'success' && 'succeeded' || 'failed' }}"
              },
              {
                "id": "pkg:cargo/lint",
                "manager": "cargo",
                "name": "lint",
                "version": "\${{ fromJSON(steps.beepboop.outputs.context).version }}",
                "required": true,
                "outcome": "\${{ steps.beepboop_publish.outcome == 'success' && 'succeeded' || 'failed' }}"
              }
            ]
`
}${variant.later ? `      - ${variant.later}\n` : ''}`,
	);
	expect(plainWorkflow).toContain("cargo publish --locked --package 'lint'");
	expect(plainWorkflow).toContain('beepboop_credentials');
	expect(plainWorkflow).not.toContain('actions/publish@');
	const anchor = variant.envAnchor
		? '      - uses: kjanat/beepboop/actions/report@v1'
		: '      - id: beepboop_credentials';
	const stepped = variant.untouched
		? plainWorkflow.replace(anchor, `      - ${variant.untouched}\n${anchor}`)
		: plainWorkflow;
	expect(stepped).toContain(variant.untouched ?? 'cargo publish');
	const seeded = variant.jobOutputs
		? stepped.replace(/^ {2}crates:\n/m, `  crates:\n    outputs:\n${variant.jobOutputs}`)
		: stepped;
	expect(seeded).toContain(variant.jobOutputs ?? 'cargo publish');
	const content = variant.ending === undefined ? seeded : `${seeded.trimEnd()}${variant.ending}`;
	world.github.push(repository, { '.github/workflows/publish-crates.yml': content }, 'Integrate crates workflow');
	const plan = await Effect.runPromise(
		parseSetupPlan(
			(await api('/api/repositories/setup/preview', { repository: repository.name, choices: lintChoices(plainLines) }))
				.body,
		),
	);
	expect(plan.blockers).toEqual([]);
	return plan.edits.find(edit => edit.path === '.github/workflows/publish-crates.yml')?.after ?? '';
};

const crateSteps = (workflow: string) =>
	decodeSync(
		mutableStruct({ jobs: mutableRecord(Schema.String, mutableStruct({ steps: mutableArray(looseStruct({})) })) }),
		parse(workflow),
	)
		.jobs.crates?.steps ?? [];
const publishStep = (workflow: string) => crateSteps(workflow).find(step => step.id === 'beepboop_publish');

test('an integrated operation workflow with plain crate lines is rewritten to the ledger step', async () => {
	const rewritten = await rewrittenPlain();
	expect(rewritten).not.toContain('beepboop_credentials');
	expect(rewritten).not.toContain('cargo publish');
	expect(rewritten).not.toContain('actions/report@');
	expect(publishStep(rewritten)).toMatchObject({
		uses: 'kjanat/beepboop/actions/publish@v1',
		with: { credentials: JSON.stringify({ CARGO_REGISTRY_TOKEN: 'crates-io' }) },
	});
	expect(publishStep(rewritten)).not.toHaveProperty('env');
});

const pinnedStep = 'uses: acme/tool@0123456789abcdef0123456789abcdef01234567 # v9.9.9';

test('the rewrite keeps the trailing comment of a step it does not change', async () => {
	const rewritten = await rewrittenPlain({ untouched: pinnedStep });
	expect(rewritten).toContain(`- ${pinnedStep}\n`);
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('an untouched step aliasing the replaced step keeps working', async () => {
	const rewritten = await rewrittenPlain({
		envAnchor: true,
		untouched: 'uses: acme/tool@0123456789abcdef0123456789abcdef01234567\n        env: *publish_env',
	});
	expect(rewritten).toContain('uses: acme/tool@0123456789abcdef0123456789abcdef01234567\n');
	expect(rewritten).toContain('CARGO_REGISTRY_TOKEN:');
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

const tokenValue = "${{ fromJSON(steps.beepboop_credentials.outputs.values)['crates-io'] }}";
const aliasingStep = 'uses: acme/tool@0123456789abcdef0123456789abcdef01234567\n        env: *publish_env';
const anchoringStep = 'run: echo other\n        env: &publish_env\n          VALUE: second';

test('an untouched step keeps the environment it aliased when a later step reuses the anchor name', async () => {
	const rewritten = await rewrittenPlain({
		envAnchor: true,
		publishEnv: '          VALUE: first\n',
		untouched: `${aliasingStep}\n      - ${anchoringStep}`,
	});
	const steps = crateSteps(rewritten);
	expect(steps.find(step => step.uses === 'acme/tool@0123456789abcdef0123456789abcdef01234567')).toMatchObject({
		env: { VALUE: 'first', CARGO_REGISTRY_TOKEN: tokenValue },
	});
	expect(steps.find(step => step.run === 'echo other')).toMatchObject({ env: { VALUE: 'second' } });
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('an untouched step keeps the environment it aliased when an earlier step reuses the anchor name', async () => {
	const rewritten = await rewrittenPlain({
		envAnchor: true,
		publishEnv: '          VALUE: first\n',
		earlier: anchoringStep,
		untouched: aliasingStep,
	});
	const steps = crateSteps(rewritten);
	expect(steps.find(step => step.uses === 'acme/tool@0123456789abcdef0123456789abcdef01234567')).toMatchObject({
		env: { VALUE: 'first', CARGO_REGISTRY_TOKEN: tokenValue },
	});
	expect(steps.find(step => step.run === 'echo other')).toMatchObject({ env: { VALUE: 'second' } });
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('a kept block scalar at the end of the file keeps its trailing newlines', async () => {
	const rewritten = await rewrittenPlain({ ending: '\nnotes: |+\n  line\n\n' });
	expect(rewritten.endsWith('notes: |+\n  line\n\n')).toBe(true);
});

test.each(['\n', ''])('the rewrite ends the workflow like the original (%j)', async ending => {
	const rewritten = await rewrittenPlain({ ending });
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
	expect(rewritten.slice(rewritten.trimEnd().length)).toBe(ending);
});

test('the rewritten publish step keeps its own environment', async () => {
	const rewritten = await rewrittenPlain({ publishEnv: '          RUSTFLAGS: -D warnings\n' });
	expect(publishStep(rewritten)).toMatchObject({
		uses: 'kjanat/beepboop/actions/publish@v1',
		env: { RUSTFLAGS: '-D warnings' },
	});
	expect(rewritten).not.toContain('CARGO_REGISTRY_TOKEN: ${{');
	expect(rewritten).not.toContain('beepboop_credentials');
});

test('the credential step stays while another step still reads its outputs', async () => {
	const rewritten = await rewrittenPlain({ publishIf: "${{ steps.beepboop_credentials.outputs.values != '' }}" });
	expect(rewritten).toContain('id: beepboop_credentials');
	expect(publishStep(rewritten)).toMatchObject({
		uses: 'kjanat/beepboop/actions/publish@v1',
		with: { credentials: JSON.stringify({ CARGO_REGISTRY_TOKEN: 'crates-io' }) },
	});
});

test.each(["steps['beepboop_credentials']", 'steps["beepboop_credentials"]'])(
	'the credential step stays while a step condition reads %s',
	async reference => {
		const rewritten = await rewrittenPlain({ publishIf: `\${{ ${reference}.outputs.values != '' }}` });
		expect(crateSteps(rewritten).map(step => step.id)).toContain('beepboop_credentials');
		expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
	},
);

test('the credential step stays while a job output reads its outputs', async () => {
	const rewritten = await rewrittenPlain({
		jobOutputs: "      granted: ${{ steps.beepboop_credentials.outputs.values != '' }}\n",
	});
	expect(crateSteps(rewritten).map(step => step.id)).toContain('beepboop_credentials');
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('a publish step with a credential in bracket notation under another name stays as written', async () => {
	const rewritten = await rewrittenPlain({
		publishEnv: "          OTHER_TOKEN: ${{ fromJSON(steps['beepboop_credentials'].outputs.values)['crates-io'] }}\n",
	});
	expect(rewritten).toBe('');
});

test('a publish step with a setting an action step cannot take stays as written', async () => {
	const rewritten = await rewrittenPlain({ publishKeys: '        working-directory: crates\n' });
	expect(rewritten).toBe('');
});

test('the rewritten publish step keeps its condition', async () => {
	const rewritten = await rewrittenPlain({ publishIf: "${{ inputs.publish != 'false' }}" });
	expect(publishStep(rewritten)).toMatchObject({
		if: "${{ inputs.publish != 'false' }}",
		uses: 'kjanat/beepboop/actions/publish@v1',
	});
});

test('the rewrite keeps a report step that still reports artifacts', async () => {
	const rewritten = await rewrittenPlain({ reportWith: '          artifacts: "[]"\n' });
	expect(rewritten).toContain('actions/report@');
	expect(rewritten).toContain('artifacts:');
	expect(rewritten).not.toContain('cargo publish');
});

test('the rewrite leaves a report step with runtime publications as written', async () => {
	const rewritten = await rewrittenPlain({ publications: '"${{ steps.results.outputs.publications }}"' });
	expect(rewritten).toContain('steps.results.outputs.publications');
	expect(rewritten).toContain('kjanat/beepboop/actions/publish@v1');
});

const reportedIds = (step: Record<string, unknown> | undefined) =>
	decodeSync(
		mapped(
			mutableStruct({ with: mutableStruct({ publications: Schema.String }) }),
			mutableArray(Schema.String),
			report =>
				decodeSync(mutableArray(mutableStruct({ id: Schema.String })), JSON.parse(report.with.publications)).map(
					entry => entry.id,
				),
			ids => ({ with: { publications: JSON.stringify(ids.map(id => ({ id }))) } }),
		),
		step,
	);

test('the rewrite leaves the report of another execution as written', async () => {
	const rewritten = await rewrittenPlain({
		reportWith: '          artifacts: "[]"\n',
		later: `uses: kjanat/beepboop/actions/report@v1
        with:
          execution-id: \${{ inputs.other_execution_id }}
          publications: '[{"id":"pkg:cargo/lint-core"},{"id":"pkg:cargo/lint"}]'`,
	});
	const reports = crateSteps(rewritten).filter(step => step.uses === 'kjanat/beepboop/actions/report@v1');
	expect(reports.map(reportedIds)).toEqual([[], lintCrates]);
	expect(reports[1]).toMatchObject({ with: { 'execution-id': '${{ inputs.other_execution_id }}' } });
});

test('the rewrite removes its emptied report and leaves the report of another execution', async () => {
	const rewritten = await rewrittenPlain({
		later: `uses: kjanat/beepboop/actions/report@v1
        with:
          execution-id: \${{ inputs.other_execution_id }}
          publications: '[{"id":"pkg:cargo/lint-core"},{"id":"pkg:cargo/lint"}]'`,
	});
	const reports = crateSteps(rewritten).filter(step => step.uses === 'kjanat/beepboop/actions/report@v1');
	expect(reports.map(reportedIds)).toEqual([lintCrates]);
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('the rewrite leaves the report sent to another service as written', async () => {
	const rewritten = await rewrittenPlain({
		reportWith: '          artifacts: "[]"\n',
		later: `uses: kjanat/beepboop/actions/report@v1
        with:
          service: https://staging.example
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
          publications: '[{"id":"pkg:cargo/lint-core"},{"id":"pkg:cargo/lint"}]'`,
	});
	const reports = crateSteps(rewritten).filter(step => step.uses === 'kjanat/beepboop/actions/report@v1');
	expect(reports.map(reportedIds)).toEqual([[], lintCrates]);
});

test('the rewrite keeps an emptied report step whose result a later step reads', async () => {
	const rewritten = await rewrittenPlain({
		reportKeys: '        id: release_report\n',
		later: 'run: echo \'${{ steps["release_report"].outputs.result }}\'',
	});
	const report = crateSteps(rewritten).find(step => step.id === 'release_report');
	expect(report).toMatchObject({ uses: 'kjanat/beepboop/actions/report@v1' });
	expect(reportedIds(report)).toEqual([]);
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test('the rewrite keeps an emptied report step whose result a job output reads', async () => {
	const rewritten = await rewrittenPlain({
		reportKeys: '        id: release_report\n',
		jobOutputs: '      result: ${{ steps.release_report.outputs.result }}\n',
	});
	const report = crateSteps(rewritten).find(step => step.id === 'release_report');
	expect(report).toMatchObject({ uses: 'kjanat/beepboop/actions/report@v1' });
	expect(reportedIds(report)).toEqual([]);
	expect(publishStep(rewritten)).toMatchObject({ uses: 'kjanat/beepboop/actions/publish@v1' });
});

test("the adoption text states each stream's own publishWhen", async () => {
	const stream = (name: string, approval: 'required' | 'merge') => ({
		packages: [`pkg:npm/${name}`],
		required: [`pkg:npm/${name}`],
		credentials: ['npm-token'],
		prepare: { strategy: 'managed' },
		promote: { approval, workflow: { file: `publish-${name}.yml`, publications: [`pkg:npm/${name}`] } },
	});
	const repository = world.github.create('octo/pair', {
		'packages/alpha/package.json': npmManifest('alpha', '1.0.0'),
		'packages/beta/package.json': npmManifest('beta', '1.0.0'),
		'README.md': '# pair\n',
		LICENSE: licenseText,
		'.github/workflows/publish-alpha.yml': publishWorkflow,
		'.github/workflows/publish-beta.yml': publishWorkflow,
		'.github/beepboop.json': jsonFile({
			$schema: 'https://beepboop.kjanat.dev/schema/v1.json',
			managers: ['npm', 'workflow'],
			streams: { alpha: stream('alpha', 'merge'), beta: stream('beta', 'required') },
		}),
	});
	const api = bearer(world, await world.cliSession());
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	const adoption = (plan.adoption ?? []).join('\n');
	const section = (name: string) =>
		adoption.slice(adoption.indexOf(`### Stream \`${name}\``)).split('### Stream')[1] ?? '';
	expect(section('alpha')).toContain('`publishWhen: version-pr-merged` applies:');
	expect(section('alpha')).not.toContain('`approved-in-beepboop`');
	expect(section('beta')).toContain('`publishWhen: approved-in-beepboop` applies');
});

const releaseText = async (setup: { stream: Record<string, unknown>; preset?: boolean }) => {
	const repository = widget(world.github, { configured: false });
	const configuration = { managers: ['npm', 'workflow'], streams: { main: setup.stream } };
	if (setup.preset) world.github.create('octo/presets', { 'release.json': JSON.stringify(configuration) });
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(
			setup.preset ? { extends: ['github>octo/presets:release'] } : configuration,
		),
	}, 'Configure release');
	const api = bearer(world, await world.cliSession());
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	return (plan.adoption ?? []).join('\n');
};
const widgetStream = (prepare: Record<string, unknown>, approval: string) => ({
	packages: ['pkg:npm/widget'],
	required: ['pkg:npm/widget'],
	prepare: { strategy: 'managed', ...prepare },
	promote: { publishWhen: approval, workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] } },
});

test('the adoption text uses the publishWhen a preset supplies', async () => {
	const text = await releaseText({ stream: widgetStream({}, 'version-pr-merged'), preset: true });
	expect(text).toContain('`publishWhen: version-pr-merged` applies');
	expect(text).not.toContain('approved-in-beepboop');
});

test('the adoption text describes a direct-commit release without a version PR', async () => {
	const text = await releaseText({
		stream: widgetStream({ versionLands: 'via-direct-commit' }, 'version-commit-pushed'),
	});
	expect(text).toContain('Beepboop pushes a signed commit with the new version to the default branch. Then');
	expect(text).toContain('`publishWhen: version-commit-pushed` applies');
	expect(text).toContain('Beepboop pushes the version commit itself.');
	expect(text).not.toContain('version PR');
});

describe('a saved plain crate publish script', () => {
	const crates = ['pkg:cargo/lint-core', 'pkg:cargo/lint'];
	const promoteCommands = async (commands: string) => {
		const repository = world.github.create('octo/lint', {
			'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.1.0"\n',
			'Cargo.lock': '# Lockfile\n',
			'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
			'crates/cli/Cargo.toml': '[package]\nname = "lint"\nversion.workspace = true\n',
		});
		const api = bearer(world, await world.cliSession());
		const choices: SetupChoices = {
			streams: [{
				name: 'main',
				packages: crates,
				required: crates,
				versioning: 'workspace',
				prepare: {
					file: 'release-lint.yml',
					job: 'prepare',
					triggers: 'review',
					commands: 'cargo check --workspace --all-targets\ncargo test --workspace',
					publicationSteps: {},
				},
				promote: { file: 'release-lint.yml', job: 'publish', triggers: 'review', commands, publicationSteps: {} },
			}],
		};
		const plan = await Effect.runPromise(
			parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
		);
		expect(plan.blockers).toEqual([]);
		return plan.choices.streams[0]?.promote?.commands;
	};
	for (
		const commands of [
			"cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint'",
			"cargo publish --locked --package 'lint'\ncargo publish --locked --package 'lint-core'",
		]
	) {
		test(`is regenerated as ${ledgerCommand}: ${commands.split('\n')[0]}`, async () => {
			expect(await promoteCommands(commands)).toBe(ledgerCommand);
		});
	}
	for (
		const commands of [
			"cargo publish --locked --package 'lint-core'",
			"cargo publish --package 'lint-core' --locked\ncargo publish --package 'lint' --locked",
			'cargo publish --locked --package lint-core\ncargo publish --locked --package lint',
			"cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint' --dry-run",
			"cargo publish --locked --package 'lint-core'\nsleep 30\ncargo publish --locked --package 'lint'",
		]
	) {
		test(`stays as the owner wrote it: ${commands.replaceAll('\n', ' | ')}`, async () => {
			expect(await promoteCommands(commands)).toBe(commands);
		});
	}
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
			approval: 'required',
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
	expect(plan.choices.streams[0]?.approval).toBe('required');
	expect(plan.choices.streams[0]?.promote?.credentials).toEqual({ CARGO_REGISTRY_TOKEN: 'crates-io' });
	const configuration = decodeSync(
		mutableStruct({
			streams: mutableStruct({
				main: mutableStruct({
					credentials: mutableArray(Schema.String),
					promote: mutableStruct({
						publishWhen: Schema.String,
						workflow: looseStruct({ publications: mutableArray(Schema.String) }),
					}),
				}),
			}),
		}),
		JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
	);
	expect(configuration.streams.main.credentials).toEqual(['crates-io']);
	expect(configuration.streams.main.promote.publishWhen).toBe('approved-in-beepboop');
	expect(configuration.streams.main.promote.workflow).toMatchObject({
		refs: { phase: 'version', prefix: 'v' },
		publications: ['pkg:cargo/sql-cli', 'pkg:cargo/sql', 'pkg:cargo/sql-parser', 'github-release:octo/sql'],
	});
	const workflow = decodeSync(
		mutableStruct({
			jobs: mutableStruct({
				publish: mutableStruct({
					steps: mutableArray(looseStruct({
						id: Schema.optional(Schema.String),
						uses: Schema.optional(Schema.String),
						run: Schema.optional(Schema.String),
						with: Schema.optional(looseStruct({ publications: Schema.optional(Schema.String) })),
					})),
				}),
			}),
		}),
		parse(plan.edits.find(edit => edit.path === '.github/workflows/release-sql.yml')?.after ?? ''),
	);
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
		const jobs = decodeSync(
			mutableStruct({
				jobs: mutableRecord(Schema.String, looseStruct({ 'timeout-minutes': Schema.optional(Schema.Finite) })),
			}),
			parse(source),
		).jobs;
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
		const repairedSteps = decodeSync(
			mutableStruct({
				jobs: mutableStruct({
					publish: mutableStruct({ steps: mutableArray(looseStruct({ id: Schema.optional(Schema.String) })) }),
				}),
			}),
			parse(after),
		).jobs.publish.steps;
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
	pull.body = `Closes #26\n\n${legacy.replace('Change `versionScope`', 'Owner note.\n\nChange `versionScope`')}`;
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
	decodeSync(
		mutableStruct({ streams: mutableStruct({ main: mutableStruct({ packages: mutableArray(Schema.String) }) }) }),
		JSON.parse(world.github.file(repository, '.github/beepboop.json', ref) ?? '{}'),
	).streams.main.packages;

test('a body edit ticks a package that the saved options from an older discovery did not offer', async () => {
	const { repository, pull } = await gadgetSetup();
	const row = decodeSync(
		mutableStruct({ document: Schema.String }),
		await world.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repository.id).first(),
	);
	const saved = decodeSync(
		looseStruct({
			options: mutableArray(looseStruct({ kind: Schema.String, package: Schema.optional(Schema.String) })),
		}),
		JSON.parse(row.document),
	);
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
						'job `publish`, step `beepboop_refs`: reads the git identity from the token step and uses an empty identity when that step is skipped',
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

test('a setup update body leads with old and new values, then held packages, choices and the folded file list', () => {
	const configuration = (rshellcheck: Record<string, unknown>, managers: string[]) =>
		JSON.stringify({
			streams: {
				rshellcheck: { packages: ['pkg:npm/%40kjanat/rshellcheck'], ...rshellcheck },
				go: {
					packages: ['pkg:golang/example.com/go'],
					promote: { workflow: { file: 'release-go.yml', publications: ['pkg:golang/example.com/go'] } },
				},
			},
			managers,
		});
	const before = configuration({
		credentials: ['npm-token'],
		workflows: {
			release: {
				file: 'release.yml',
				publications: ['pkg:npm/%40kjanat/rshellcheck', 'pkg:github/octo/shellcheck'],
				needs: ['promote'],
			},
		},
		promote: { approval: 'required', workflow: { file: 'release-rshellcheck.yml', publications: [] } },
	}, ['npm']);
	const after = configuration({
		credentials: ['npm-token', 'crates-io'],
		workflows: { release: { file: 'release.yml', publications: ['pkg:npm/%40kjanat/rshellcheck'] } },
		promote: {
			publishWhen: 'version-pr-merged',
			workflow: {
				file: 'release-rshellcheck.yml',
				publications: ['github-release:octo/shellcheck'],
				setup: { job: 'promote' },
			},
		},
		prepare: { versionLands: 'via-version-pr' },
		startFrom: [{ via: 'action', workflow: 'start-release.yml' }, { via: 'cli' }],
	}, ['github-release', 'npm']);
	const promoteOnly = 'jobs:\n  promote:\n    steps: []\n';
	const binaries = {
		path: '.github/workflows/release-rshellcheck.yml',
		before: promoteOnly,
		after: `jobs:\n  build-rshellcheck:\n    steps: []\n${promoteOnly.slice('jobs:\n'.length)}`,
	};
	const edits = [
		{ path: '.github/beepboop.json', before, after },
		binaries,
		{ path: '.github/workflows/start-release.yml', before: '', after: 'jobs: {}\n' },
	];
	const changes = [
		'- `rshellcheck`',
		'  - `credentials` changes.',
		'  - `workflows.release.publications`: removes `pkg:github/octo/shellcheck`.',
		'  - `workflows.release.needs`: `promote` → none.',
		'  - `promote.publishWhen`: `approved-in-beepboop` → `version-pr-merged`. Merging the version PR publishes it once the checks pass. Nobody publishes it in Beepboop.',
		'  - `promote.workflow.publications`: adds `github-release:octo/shellcheck`. This workflow now publishes the GitHub release.',
		'  - `prepare.versionLands`: none → `via-version-pr`. Beepboop opens a version PR, and merging it puts the new version on the default branch.',
		'  - `startFrom`: none → `action` (`start-release.yml`), `cli`. Starting a release also publishes it, and nothing asks again.',
		'- Repository',
		'  - `managers`: adds `github-release`.',
		'  - Renames the settings to their current names: `publishWhen`, `versionLands`, `startFrom`, `mustPublish`, `versionScope` and `existingTriggers`.',
		'  - `.github/beepboop.json` records the setup input that generates its workflows.',
		'- Workflows',
		'  - `release-rshellcheck.yml` builds the `rshellcheck` release binaries.',
		'  - Adds `.github/workflows/start-release.yml`.',
	];
	expect(behaviourChanges(edits)).toEqual(changes);
	expect(setupTitle(updateBranch, edits)).toBe('chore: update release setup');
	expect(setupTitle(updateBranch, [binaries])).toBe('chore: build rshellcheck release binaries');
	const flipped = after.replace('"publishWhen":"version-pr-merged"', '"publishWhen":"approved-in-beepboop"');
	expect(flipped).not.toBe(after);
	expect(setupTitle(updateBranch, [{ path: '.github/beepboop.json', before: flipped, after }, binaries])).toBe(
		'chore: update release setup (release binaries, publishWhen)',
	);
	const unrecorded = after.replace(',"setup":{"job":"promote"}', '');
	expect(unrecorded).not.toBe(after);
	expect(setupTitle(updateBranch, [{ path: '.github/beepboop.json', before: unrecorded, after }, binaries])).toBe(
		'chore: build rshellcheck release binaries',
	);
	const evidence = (file: string) => ({
		file,
		jobs: ['promote'],
		steps: [],
		events: ['workflow_dispatch'],
		roles: [],
		preparationJobs: [],
		reportingJobs: [],
		prepares: false,
		reports: false,
		publishes: true,
	});
	const held =
		'@kjanat/rshellcheck (npm/package.json) lacks a license file. Beepboop holds its release until the package has them.';
	const plan: SetupPlan = {
		repository: 'octo/shellcheck',
		sourceSha: 'a'.repeat(40),
		planId: 'plan',
		setupHead: null,
		choices: decodeSync(setupChoicesSchema, {
			streams: [
				{
					name: 'rshellcheck',
					packages: ['pkg:npm/%40kjanat/rshellcheck'],
					required: ['pkg:npm/%40kjanat/rshellcheck'],
					versioning: 'workspace',
					approval: 'merge',
					bump: 'pr',
					start: ['action', 'cli'],
					promote: { file: 'release-rshellcheck.yml', job: 'promote' },
				},
				{
					name: 'go',
					packages: ['pkg:golang/example.com/go'],
					required: ['pkg:golang/example.com/go'],
					versioning: 'workspace',
					versionSource: { kind: 'tags', prefix: 'go/v' },
					promote: { file: 'release-go.yml', job: 'promote' },
				},
			],
		}),
		inventory: {
			packages: [
				{ name: '@kjanat/rshellcheck', manifest: 'npm/package.json', publication: { kind: 'registry' } },
				{ name: 'example.com/go', manifest: 'go/go.mod', publication: { kind: 'registry' } },
			],
		},
		packageIds: ['pkg:npm/%40kjanat/rshellcheck', 'pkg:golang/example.com/go'],
		workflows: [evidence('release-rshellcheck.yml'), evidence('release-go.yml')],
		edits,
		blockers: [],
		notes: [held, 'Discovery: @kjanat/rshellcheck declares no repository'],
		branchConflict: false,
	};
	const body = setupBody(plan, { branch: updateBranch, defaultBranch: 'master' });
	for (const tagPatterns of [[], ['v*']]) {
		const observedStream = {
			...plan.choices.streams[0]!,
			promote: undefined,
			observe: [{ name: 'publish', file: 'release.yml', ref: 'refs/heads/main', publications: ['pkg:npm/widget'] }],
		};
		const summary = streamSummary(observedStream, {
			...plan,
			workflows: [{ ...evidence('release.yml'), events: ['push', 'workflow_dispatch'], tagPatterns }],
		}).join('\n');
		expect(summary).toContain(
			tagPatterns.length ? 'Tags matching v* start release.yml' : 'Release.yml runs on its own triggers',
		);
	}

	const observed = {
		...plan,
		choices: {
			...plan.choices,
			streams: [{
				...plan.choices.streams[0]!,
				promote: undefined,
				observe: [
					{ name: 'npm', file: 'release.yml', ref: 'refs/tags/v*', publications: ['pkg:npm/widget'] },
					{ name: 'github', file: 'release.yml', ref: 'refs/tags/v*', publications: ['pkg:github/octo/widget'] },
				],
			}],
		},
	};
	expect(
		setupBody(observed, { branch: updateBranch, defaultBranch: 'master' }).split('\n').find(line =>
			line.startsWith('  - Publication:')
		),
	).toBe('  - Publication: observes `release.yml`');

	expect(body.slice(0, body.indexOf('### Choices'))).toBe(
		`Beepboop inspected [\`${'a'.repeat(12)}\`](https://github.com/octo/shellcheck/commit/${
			'a'.repeat(40)
		}), the head of \`master\`.\n\n### What changes\n\n${
			changes.join('\n')
		}\n\n### Held packages\n\n- \`@kjanat/rshellcheck\` (\`npm/package.json\`) lacks a license file. Beepboop holds its release until the package has them.\n\n`,
	);
	expect(body).toContain(
		'  - `versionLands`: How a new version reaches the default branch, here `master`. Tick one.\n',
	);
	expect(body).toContain(
		'  - `go` takes its version from `go/v` tags. Beepboop raises no version for it, so it offers no `startFrom` or `versionLands`.\n',
	);
	expect(body.match(/existingTriggers: keep-and-report/g)).toHaveLength(1);
	expect(body).toContain(
		'- `release-rshellcheck.yml` and `release-go.yml`, `existingTriggers: keep-and-report`: The workflow keeps its existing triggers. Beepboop reports a trigger that conflicts with its dispatch.',
	);
	expect(body).toContain('- Discovery: `@kjanat/rshellcheck` declares no repository');
	expect(body).not.toMatch(/(?:^|[\s(])@kjanat\//m);
	expect(body.endsWith(`${changeDetails(edits)}\n`)).toBe(true);
	expect(body.indexOf('Release after merge')).toBeLessThan(body.indexOf('- Discovery'));
	expect(bodyChoices(body, setupOptions(plan), plan.choices).streams[0]).toMatchObject({
		approval: 'merge',
		bump: 'pr',
		start: ['action', 'cli'],
	});
	expect(releaseAfterMerge(body)).toBe(false);
	expect(releaseAfterMerge(setupBody(plan, { branch: updateBranch, defaultBranch: 'master', release: true }))).toBe(
		true,
	);
	const onboarding = setupBody({ ...plan, notes: [] }, { branch: onboardingBranch, defaultBranch: 'master' });
	expect([onboarding.includes('### What changes'), onboarding.includes('<details>')]).toEqual([false, false]);
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
	const described = () => {
		const sha = world.github.head(repository);
		const opening =
			`<!-- beepboop:setup:start -->\nBeepboop inspected [\`${
				sha.slice(0, 12)
			}\`](https://github.com/${repository.name}/commit/${sha}), the head of \`main\`.\n\n`
			+ '### What changes\n\n- Workflows\n  - Jobs get timeouts that stop a hung run.\n\n### Choices\n\n';
		const details =
			`<details>\n<summary>Every changed file and path</summary>\n\n- \`${file}\`\n  - job \`promote\`: sets \`timeout-minutes\` to ${
				publishMinutes(1)
			}, which stops a hung run\n\n</details>\n`;
		expect([update.head.ref, update.title, update.body.slice(0, opening.length)]).toEqual([
			'automation/setup-update',
			'chore: update release setup (job timeouts)',
			opening,
		]);
		expect(update.body).toContain(details);
		expect(update.body.indexOf('Release after merge')).toBeLessThan(update.body.indexOf('<details>'));
	};
	described();
	world.github.push(repository, { 'README.md': '# widget\n\nMoved on.\n' }, 'Move the default branch');
	const head = update.head.sha;
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(update.head.sha).not.toBe(head);
	described();
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
	expect(decodeSync(mutableArray(mutableStruct({ action: Schema.String })), audits.results).map(row => row.action))
		.toEqual([]);
});

test('a package ticked again in an observed stream becomes required again', () => {
	const go = 'pkg:golang/github.com/kjanat/shellcheck-rs/bindings/wasm/go';
	const npm = 'pkg:npm/%40kjanat/rshellcheck';
	const stream: SetupChoices['streams'][number] = {
		name: 'rshellcheck',
		packages: [npm],
		required: [npm],
		versioning: 'workspace',
		observe: [{ name: 'release', file: 'release.yml', publications: [npm] }],
	};
	const options: Parameters<typeof bodyChoices>[1] = [npm, go].map(id => ({
		kind: 'package',
		stream: 'rshellcheck',
		package: id,
	}));
	const box = (id: string) =>
		`- [x] <!-- beepboop:choice:package:rshellcheck:${encodeURIComponent(id).replaceAll('-', '%2D')} -->`;
	const chosen = bodyChoices(`${box(npm)}\n${box(go)}\n`, options, { streams: [stream] }).streams[0];
	expect(chosen).toMatchObject({ packages: [npm, go], required: [npm, go] });
	const unticked = bodyChoices(`${box(npm)}\n${box(go).replace('[x]', '[ ]')}\n`, options, {
		streams: [{ ...stream, packages: [npm, go] }],
	}).streams[0];
	expect(unticked).toMatchObject({ packages: [npm], required: [npm] });
});

test('a shared preparation and publication workflow keeps step comments and its missing final newline', async () => {
	const repository = lintRepository();
	const api = bearer(world, await world.cliSession());
	const gate = (operation: string) => `\${{ inputs.beepboop_operation == '${operation}' }}`;
	const existing = `name: Release
on:
  workflow_dispatch:
    inputs:
      beepboop_operation:
        type: choice
        options: [prepare, publish]
        default: publish
jobs:
  prepare:
    if: ${gate('prepare')}
    runs-on: ubuntu-latest
    steps:
      - uses: acme/tool@0123456789abcdef0123456789abcdef01234567 # v9.9.9
  publish:
    if: ${gate('publish')}
    runs-on: ubuntu-latest
    steps:
      - run: echo ready`;
	world.github.push(repository, { '.github/workflows/release.yml': existing }, 'Add shared workflow');
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: lintCrates,
			required: lintCrates,
			versioning: 'workspace',
			prepare: {
				file: 'release.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo check --workspace',
				publicationSteps: {},
			},
			promote: {
				file: 'release.yml',
				job: 'publish',
				triggers: 'review',
				commands: ledgerCommand,
				publicationSteps: {},
			},
		}],
	};
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	expect(after).toContain('- uses: acme/tool@0123456789abcdef0123456789abcdef01234567 # v9.9.9\n');
	expect(after).toContain('actions/publish@');
	expect(after.endsWith('\n')).toBe(false);
});

test('integrating a workflow keeps a step that aliases an anchor in a dispatch input default', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/ship.yml': `name: Ship
on:
  workflow_dispatch:
    inputs:
      tool_version:
        description: Tool version
        required: false
        default: &tool_version '1.2.3'
jobs:
  ship:
    runs-on: ubuntu-latest
    steps:
      - uses: acme/tool@v1
        with:
          version: *tool_version
      - id: publish_existing
        run: npm publish
`,
	}, 'Add ship workflow');
	const api = bearer(world, await world.cliSession());
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: {
				file: 'ship.yml',
				job: 'ship',
				triggers: 'review',
				commands: '',
				publicationSteps: { 'pkg:npm/widget': 'publish_existing' },
			},
		}],
	};
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/ship.yml')?.after ?? '';
	expect(after).toContain('beepboop_execution_id');
	const { jobs } = decodeSync(
		mutableStruct({
			jobs: mutableStruct({
				ship: mutableStruct({ steps: mutableArray(looseStruct({ uses: Schema.optional(Schema.String) })) }),
			}),
		}),
		parse(after),
	);
	expect(jobs.ship.steps.find(step => step.uses === 'acme/tool@v1')).toMatchObject({ with: { version: '1.2.3' } });
});
