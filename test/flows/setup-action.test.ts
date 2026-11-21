import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { requestBody } from '@root/actions/runtime/protocol.ts';
import { materialize } from '@root/test/support/actions.ts';
import { npmManifest } from '@root/test/support/repositories.ts';
import { Effect, Result } from 'effect';
import { parse, stringify } from 'yaml';
import { discover } from '@/automation/managers';
import { previewSetup } from '@/automation/setup';
import { actionReleaseOffer } from '@/automation/setup-action';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import type { Snapshot } from '@/automation/types';

function snapshot(files: Record<string, string>): Snapshot {
	return {
		repository: { id: 1, name: 'octo/action', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
}
function preview(source: Snapshot, choices?: SetupChoices) {
	return Effect.runPromise(previewSetup(source, discover(source), choices, { head: null }));
}

test('Yarn build suggestions respect the packageManager major version', () => {
	for (const [version, install] of [['1.22.22', '--frozen-lockfile'], ['4.10.3', '--immutable']]) {
		const offer = actionReleaseOffer(
			snapshot({
				'action.yml': 'runs: {using: node24, main: main.mjs}',
				'package.json': JSON.stringify({ packageManager: `yarn@${version}`, scripts: { build: 'tsdown' } }),
			}),
		);
		expect(offer?.commands).toBe(`yarn install ${install}\nyarn build`);
	}
});

test('a new distribution workflow builds the action and publishes selected npm packages', async () => {
	const source = snapshot({
		'action.yml': 'runs: {using: node24, main: dist/main.mjs}',
		'package.json': JSON.stringify({
			...JSON.parse(npmManifest('widget', '1.0.0')),
			packageManager: 'bun@1.4.4',
			scripts: { build: 'tsdown' },
		}),
	});
	const plan = await preview(source, {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			actionRelease: { kind: 'distribution', files: ['dist/main.mjs'] },
		}],
	});
	expect(plan.blockers).toEqual([]);
	const workflow = parse(plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after);
	const steps = workflow.jobs.promote.steps;
	const build = steps.findIndex((step: { run?: string }) => step.run?.includes('bun run build'));
	const publish = steps.findIndex((step: { uses?: string }) => step.uses?.includes('/actions/publish@'));
	expect(build).toBeGreaterThanOrEqual(0);
	expect(publish).toBeGreaterThan(build);
	expect(steps.some((step: { uses?: string }) => step.uses?.includes('/actions/report@'))).toBe(false);
});

test('manual publication workflows inherit their configured ref prefix and receive ref and Release steps', async () => {
	const source = snapshot({ 'action.yml': 'runs: {using: composite, steps: []}' });
	const first = await preview(source, {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'none',
			actionRelease: { kind: 'source' },
			promote: {
				file: 'release.yml',
				job: 'promote',
				commands: '',
				triggers: 'dispatchOnly',
				publicationSteps: {},
				tagPrefix: 'tool-v',
			},
		}],
	});
	const files = { ...source.files, ...Object.fromEntries(first.edits.map(edit => [edit.path, edit.after])) };
	const config = JSON.parse(files['.github/beepboop.json']!);
	delete config.streams.main.promote.workflow.setup;
	config.streams.main.promote.workflow.refs = { phase: 'version', prefix: 'tool-v', signed: true };
	delete config.streams.main.workflows;
	files['.github/beepboop.json'] = JSON.stringify(config);
	delete files['.github/workflows/action-aliases.yml'];
	const workflow = parse(files['.github/workflows/release.yml']!);
	workflow.jobs.promote.steps = workflow.jobs.promote.steps.filter((step: { uses?: string }) =>
		!/\/actions\/(?:publish-refs|publish-release|token)@/.test(step.uses ?? '')
	);
	files['.github/workflows/release.yml'] = stringify(workflow);
	const plan = await preview(snapshot(files), {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'none',
			actionRelease: { kind: 'source' },
			promote: { file: 'release.yml', job: 'promote', commands: '', triggers: 'dispatchOnly', publicationSteps: {} },
		}],
	});
	expect(plan.blockers).toEqual([]);
	const next = JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')!.after).streams.main;
	expect(next.promote.workflow.refs.prefix).toBe('tool-v');
	expect(next.workflows.aliases.refs.prefix).toBe('tool-v');
	const content = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after;
	expect(content).toContain('/actions/publish-refs@');
	expect(content).toContain('/actions/publish-release@');
});

test('an identical build before the reviewed checkout does not satisfy distribution publication', async () => {
	const source = snapshot({
		'action.yml': 'runs: {using: node24, main: main.mjs}',
		'main.mjs': 'source',
		'package.json': JSON.stringify({ private: true, packageManager: 'bun@1.4.4', scripts: { build: 'tsdown' } }),
	});
	const first = await preview(source, {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'none',
			actionRelease: { kind: 'distribution', files: ['main.mjs'] },
		}],
	});
	const files = { ...source.files, ...Object.fromEntries(first.edits.map(edit => [edit.path, edit.after])) };
	const workflow = parse(files['.github/workflows/release.yml']!);
	const steps = workflow.jobs.promote.steps;
	const [build] = steps.splice(steps.findIndex((step: { run?: string }) => step.run?.includes('bun run build')), 1);
	const reviewed = steps.findIndex((step: { with?: { ref?: string } }) => step.with?.ref?.includes('sourceSha'));
	steps.splice(reviewed, 0, build);
	files['.github/workflows/release.yml'] = stringify(workflow);
	expect((await preview(snapshot(files), first.choices)).blockers).toEqual([
		'release.yml: move the steps before the checkout of the execution sourceSha after that checkout',
	]);
	steps.splice(steps.indexOf(build), 1);
	steps.unshift(build);
	files['.github/workflows/release.yml'] = stringify(workflow);
	const plan = await preview(snapshot(files), first.choices);
	expect(plan.blockers).toEqual([]);
	const nextSteps =
		parse(plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after).jobs.promote.steps;
	const checkout = nextSteps.findIndex((step: { with?: { ref?: string } }) => step.with?.ref?.includes('sourceSha'));
	const refs = nextSteps.findIndex((step: { uses?: string }) => step.uses?.includes('/actions/publish-refs@'));
	expect(nextSteps.slice(checkout + 1, refs).some((step: { run?: string }) => step.run?.includes('bun run build')))
		.toBe(true);
});

test('adoption offers action refs only for action metadata at root or nested paths', async () => {
	expect(actionReleaseOffer(snapshot({ 'README.md': 'hi' }))).toBeUndefined();
	for (const path of ['action.yml', 'action.yaml', 'actions/tool/action.yml', 'packages/tool/action.yaml']) {
		const source = snapshot({ [path]: 'name: Tool\nruns:\n  using: composite\n  steps: []\n' });
		const plan = await preview(source);
		expect(plan.actionRelease).toEqual({ manifests: [path], files: [], missing: [], commands: '' });
		expect(plan.choices.streams.every(stream => stream.actionRelease === undefined)).toBe(true);
		expect((await Effect.runPromise(parseSetupPlan(plan))).actionRelease).toEqual(plan.actionRelease);
	}
});

test('JavaScript entry points resolve against their metadata folder and reject unsafe paths', () => {
	const source = snapshot({
		'packages/a/action.yaml':
			'runs:\n  using: node24\n  main: ./bundle/start.mjs\n  post: bundle/finish.mjs\n  pre: ../../shared/pre.mjs\n',
		'packages/a/bundle/finish.mjs': '// saved',
		'action.yml': 'runs:\n  using: node24\n  main: /absolute.mjs\n  post: ${{ inputs.path }}\n  pre: ../escape.mjs\n',
		'package.json': JSON.stringify({ private: true, packageManager: 'bun@1.4.4', scripts: { build: 'tsdown' } }),
	});
	expect(actionReleaseOffer(source)).toEqual({
		manifests: ['action.yml', 'packages/a/action.yaml'],
		files: ['packages/a/bundle/finish.mjs', 'packages/a/bundle/start.mjs', 'shared/pre.mjs'],
		missing: ['packages/a/bundle/start.mjs', 'shared/pre.mjs'],
		commands: 'bun install --frozen-lockfile\nbun run build',
	});
});

test('composite and Docker actions can adopt immutable patch releases and dependent major/minor refs', async () => {
	for (const runs of ['using: composite\n  steps: []', 'using: docker\n  image: Dockerfile']) {
		const source = snapshot({ 'action.yml': `name: Tool\nruns:\n  ${runs}\n` });
		const plan = await preview(source, {
			streams: [{ name: 'main', packages: [], required: [], versioning: 'none', actionRelease: { kind: 'source' } }],
		});
		expect(plan.blockers).toEqual([]);
		const config = JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')!.after);
		expect(config.streams.main.promote.workflow.refs).toEqual({
			phase: 'version',
			prefix: 'v',
			signed: true,
			immutable: true,
		});
		expect(config.streams.main.versionSource).toEqual({ kind: 'tags', prefix: 'v' });
		expect(config.streams.main.workflows.aliases).toMatchObject({
			needs: ['promote'],
			refs: { phase: 'aliases', aliases: ['major', 'minor'] },
		});
		const release = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after;
		expect(release).toContain('/actions/publish-release@');
		expect(release).not.toContain('bun run build');
		const aliases = plan.edits.find(edit => edit.path === '.github/workflows/action-aliases.yml')!.after;
		expect(aliases).toContain('operation: aliases');
		expect(aliases).toContain('/actions/publish-refs@');
	}
});

test('an action-only stream retains its selected prefix across patch, minor and major refs', async () => {
	const source = snapshot({ 'action.yml': 'name: Tool\nruns:\n  using: composite\n  steps: []\n' });
	const plan = await preview(source, {
		streams: [{
			name: 'tool',
			packages: [],
			required: [],
			versioning: 'none',
			versionSource: { kind: 'tags', prefix: 'tool-v' },
			actionRelease: { kind: 'source' },
		}],
	});
	expect(plan.blockers).toEqual([]);
	const stream = JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')!.after).streams.tool;
	expect(stream.versionSource.prefix).toBe('tool-v');
	expect(stream.promote.workflow.refs.prefix).toBe('tool-v');
	expect(stream.workflows.aliases.refs.prefix).toBe('tool-v');
	expect(stream.workflows.aliases.refs.aliases).toEqual(['major', 'minor']);
});

test('adopting action aliases blocks an unrelated aliases operation without replacing it', async () => {
	const source = snapshot({ 'action.yml': 'name: Tool\nruns:\n  using: composite\n  steps: []\n' });
	const choices: SetupChoices = {
		streams: [{ name: 'main', packages: [], required: [], versioning: 'none', actionRelease: { kind: 'source' } }],
	};
	const adopted = await preview(source, choices);
	const files = { ...source.files, ...Object.fromEntries(adopted.edits.map(edit => [edit.path, edit.after])) };
	const config = JSON.parse(files['.github/beepboop.json']!);
	const ownerAliases = {
		file: 'owner-other.yml',
		ref: 'main',
		needs: ['promote'],
		publications: [],
		refs: { phase: 'aliases', prefix: 'custom-', aliases: ['major'] },
	};
	config.streams.main.workflows.aliases = ownerAliases;
	files['.github/beepboop.json'] = JSON.stringify(config);
	const plan = await preview(snapshot(files), choices);
	expect(plan.blockers.some(blocker => blocker.includes('aliases operation or workflow is already in use'))).toBe(true);
	const next = JSON.parse(
		plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? files['.github/beepboop.json'],
	);
	expect(next.streams.main.workflows.aliases).toEqual(ownerAliases);
	expect(plan.edits.some(edit => edit.path === '.github/workflows/action-aliases.yml')).toBe(false);
});

test('switching an existing managed source action to distribution inserts the chosen build before publication', async () => {
	for (const shared of [false, true]) {
		const source = snapshot({
			'action.yml': 'name: Tool\nruns:\n  using: node24\n  main: main.mjs\n',
			'main.mjs': 'original',
			'package.json': JSON.stringify({ private: true, packageManager: 'bun@1.4.4', scripts: { build: 'tsdown' } }),
		});
		const first = await preview(source, {
			streams: [{
				name: 'main',
				packages: [],
				required: [],
				versioning: 'none',
				actionRelease: { kind: 'source' },
				...(shared
					? {
						prepare: {
							file: 'release.yml',
							job: 'prepare',
							triggers: 'dispatchOnly' as const,
							commands: 'true',
							publicationSteps: {},
						},
						promote: {
							file: 'release.yml',
							job: 'publish',
							triggers: 'dispatchOnly' as const,
							commands: '',
							publicationSteps: {},
							tagPrefix: 'v',
						},
					}
					: {}),
			}],
		});
		const adopted = snapshot({
			...source.files,
			...Object.fromEntries(first.edits.map(edit => [edit.path, edit.after])),
		});
		const commands = 'bun install --frozen-lockfile\nbun run build';
		const plan = await preview(adopted, {
			streams: [{
				...first.choices.streams[0]!,
				actionRelease: { kind: 'distribution', files: ['main.mjs'] },
				promote: { ...first.choices.streams[0]!.promote!, commands },
			}],
		});
		expect(plan.blockers).toEqual([]);
		const workflow = parse(plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after);
		const steps = workflow.jobs[shared ? 'publish' : 'promote'].steps;
		const build = steps.findIndex((step: { run?: string }) => step.run?.trim() === commands);
		const refs = steps.findIndex((step: { uses?: string }) => step.uses?.includes('/publish-refs@'));
		expect(build).toBeGreaterThanOrEqual(0);
		expect(build).toBeLessThan(refs);
		expect(steps.some((step: { uses?: string }) => step.uses?.startsWith('oven-sh/setup-bun@'))).toBe(true);
	}
});

test('distribution adoption publishes the reviewed file list and builds using packageManager', async () => {
	const source = snapshot({
		'action.yaml': 'name: Tool\nruns:\n  using: node24\n  main: output/start.mjs\n  post: output/finish.mjs\n',
		'package.json': JSON.stringify({
			name: 'tool',
			version: '1.0.0',
			private: true,
			packageManager: 'bun@1.4.4',
			scripts: { build: 'tsdown' },
		}),
	});
	const files = ['output/start.mjs', 'output/finish.mjs', 'output/LICENSES.txt'];
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'none',
			actionRelease: { kind: 'distribution', files },
		}],
	};
	const plan = await preview(source, choices);
	expect(plan.blockers).toEqual([]);
	const config = JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')!.after);
	expect(config.streams.main.promote.workflow.refs).toMatchObject({
		immutable: true,
		signed: true,
		distribution: { files, ancestry: 'ours' },
	});
	const content = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after;
	const workflow = parse(content);
	const steps = workflow.jobs.promote.steps;
	expect(steps.find((step: { uses?: string }) => step.uses?.includes('oven-sh/setup-bun@'))).toEqual({
		uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
	});
	const input = steps.find((step: { uses?: string }) => step.uses?.includes('/publish-refs@')).with.files;
	const checkout = materialize(source.files);
	try {
		for (const file of files) await Bun.write(join(checkout.dir, file), `built ${file}`);
		const request = requestBody('refs-plan', {
			EXECUTION_ID: 'execution',
			DISTRIBUTION_PATHS: input,
			GITHUB_WORKSPACE: checkout.dir,
		}, 0);
		expect(Result.isSuccess(request)).toBe(true);
		if (Result.isSuccess(request)) {
			expect(request.success).toEqual({
				executionId: 'execution',
				files: files.map(path => ({
					path,
					before: '',
					encoding: 'base64',
					mode: '100644',
					after: Buffer.from(`built ${path}`).toString('base64'),
				})),
			});
		}
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
	}
	expect(content).toContain('bun run build');
	expect(content).not.toContain('bun-version');
	const refreshed = await preview(
		snapshot({ ...source.files, ...Object.fromEntries(plan.edits.map(edit => [edit.path, edit.after])) }),
	);
	expect(refreshed.blockers).toEqual([]);
	expect(refreshed.choices.streams[0]?.actionRelease).toEqual({ kind: 'distribution', files });
	expect(refreshed.edits).toEqual([]);
	const committed = snapshot({
		...source.files,
		...Object.fromEntries(plan.edits.map(edit => [edit.path, edit.after])),
		'output/start.mjs': 'built',
		'output/finish.mjs': 'built',
	});
	const switched = await preview(committed, {
		streams: [{
			...refreshed.choices.streams[0]!,
			actionRelease: { kind: 'source' },
			promote: { ...refreshed.choices.streams[0]!.promote!, commands: '' },
		}],
	});
	expect(switched.blockers).toEqual([]);
	const switchedWorkflow = parse(switched.edits.find(edit => edit.path === '.github/workflows/release.yml')!.after);
	const switchedRefs = switchedWorkflow.jobs.promote.steps.find((step: { uses?: string }) =>
		step.uses?.includes('/publish-refs@')
	);
	expect(switchedRefs.with.files).toBeUndefined();
	expect(
		Result.getOrThrow(
			requestBody('refs-plan', { EXECUTION_ID: 'execution', DISTRIBUTION_PATHS: switchedRefs.with.files }, 0),
		),
	).toEqual({ executionId: 'execution' });
	const untouched = await preview(source, {
		streams: choices.streams.map(({ actionRelease: _action, ...stream }) => stream),
	});
	expect(untouched.edits.some(edit => edit.path.endsWith('action-aliases.yml'))).toBe(false);
	expect(untouched.edits.find(edit => edit.path === '.github/beepboop.json')?.after).not.toContain('immutable');
});

test('a new stream beside a configured one gets its own default prefix', async () => {
	const source = snapshot({ 'action.yml': 'name: Tool\nruns:\n  using: composite\n  steps: []\n' });
	const first = await preview(source, {
		streams: [{ name: 'main', packages: [], required: [], versioning: 'none', actionRelease: { kind: 'source' } }],
	});
	const adopted = snapshot({
		...source.files,
		...Object.fromEntries(first.edits.map(edit => [edit.path, edit.after])),
	});
	const plan = await preview(adopted, {
		streams: [{
			name: 'tools',
			packages: [],
			required: [],
			versioning: 'none',
			actionRelease: { kind: 'source' },
			promote: { file: 'tools.yml', job: 'promote', commands: '', triggers: 'dispatchOnly', publicationSteps: {} },
		}],
	});
	const streams = JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')!.after).streams;
	expect(streams.main.promote.workflow.refs.prefix).toBe('v');
	expect(streams.tools.promote.workflow.refs.prefix).toBe('tools-v');
});
