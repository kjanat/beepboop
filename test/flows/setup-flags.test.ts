import { beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { PromptEngine } from '@kjanat/dreamcli';
import { generateCompletion } from '@kjanat/dreamcli/completion';
import { savedClient } from '@root/test/support/cli.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { z } from 'zod';
import { app } from '@/cli/cli';
import { choicesFlagKinds, setupFlagPaths, streamFlagKinds, workflowFlagKinds } from '@/cli/setup-flags';
import { approvalPolicies, startChannels, versionBumps } from '@/contract/release-start';
import { binaryTargets, setupChoicesSchema, streamVersionings, workflowTriggers } from '@/contract/setup';
import { choicesFields, streamFields, workflowFields } from '@/contract/setup-fields';

let world: World;
let directory: string;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-setup-flags-', created => {
	directory = created;
});
beforeEach(async () => {
	await savedClient(world, directory);
});

function tool() {
	return world.github.create('octo/tool', {
		'Cargo.toml':
			'[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\ndescription = "A tool"\nlicense = "MIT"\nrepository = "https://github.com/octo/tool"\n\n[dependencies]\nnix = "0.30"\n',
		'README.md': '# tool\n',
		'LICENSE': 'MIT\n',
		'src/main.rs': 'fn main() {}\n',
		'js/package.json': JSON.stringify({
			name: 'tool-js',
			version: '1.0.0',
			description: 'JavaScript bindings',
			license: 'MIT',
			repository: 'https://github.com/octo/tool',
		}),
		'js/README.md': '# tool-js\n',
		'js/LICENSE': 'MIT\n',
	});
}
const promote = ['--promote-file', 'release-tool.yml'];

const silent: PromptEngine = {
	promptOne(config) {
		throw new Error(`Unexpected prompt: ${config.message}`);
	},
};

const previewed = z.looseObject({
	choices: setupChoicesSchema,
	blockers: z.array(z.string()),
	notes: z.array(z.string()),
});

async function preview(args: string[]) {
	const result = await app.execute(['adopt', 'octo/tool', '--json', ...args], { isTTY: false, env: {} });
	expect([result.exitCode, result.stderr.join('')]).toEqual([0, '']);
	return previewed.parse(JSON.parse(result.stdout.join('')));
}

function main(choices: z.output<typeof setupChoicesSchema>) {
	const stream = choices.streams.find(entry => entry.name === 'main');
	if (!stream) throw new Error('no main stream');
	return stream;
}

const id = 'pkg:cargo/tool';
const build = { toolchain: 'cargo', name: 'tool', manifest: 'Cargo.toml', asset: '{name}-{rust.target}{ext}' };
const cases: {
	flags: string[];
	args: string[];
	read: (choices: z.output<typeof setupChoicesSchema>) => unknown;
	value: unknown;
}[] = [
	{
		flags: ['stream'],
		args: ['--stream', 'extra', '--package', 'tool'],
		read: c => c.streams.map(s => s.name),
		value: ['main', 'extra'],
	},
	{
		flags: ['package'],
		args: ['--package', 'tool'],
		read: c => [main(c).packages, main(c).required],
		value: [[id], [id]],
	},
	{ flags: ['required'], args: ['--required', id], read: c => main(c).required, value: [id] },
	{ flags: ['versioning'], args: ['--versioning', 'independent'], read: c => main(c).versioning, value: 'independent' },
	{
		flags: ['start'],
		args: ['--start', 'cli', '--start', 'dashboard'],
		read: c => main(c).start,
		value: ['cli', 'dashboard'],
	},
	{ flags: ['bump'], args: ['--bump', 'commit'], read: c => main(c).bump, value: 'commit' },
	{ flags: ['approval'], args: ['--approval', 'merge'], read: c => main(c).approval, value: 'merge' },
	{
		flags: ['version-source'],
		args: ['--version-source', '{"kind":"tags","prefix":"tool-v"}'],
		read: c => main(c).versionSource,
		value: { kind: 'tags', prefix: 'tool-v' },
	},
	{ flags: ['version-files'], args: ['--version-files', '[]'], read: c => main(c).versionFiles, value: [] },
	{ flags: ['observe'], args: ['--observe', '[]'], read: c => main(c).observe, value: [] },
	{ flags: ['needs'], args: ['--needs', '{}'], read: c => main(c).needs, value: {} },
	{ flags: ['operations'], args: ['--operations', '[]'], read: c => main(c).operations, value: [] },
	{
		flags: ['prepare-file', 'prepare-job', 'prepare-triggers', 'prepare-commands', 'prepare-tag-prefix'],
		args: [
			'--prepare-file',
			'prepare-tool.yml',
			'--prepare-job',
			'prep',
			'--prepare-triggers',
			'dispatchOnly',
			'--prepare-commands',
			'cargo check',
			'--prepare-tag-prefix',
			'tool-v',
		],
		read: c => {
			const prepare = main(c).prepare;
			return [prepare?.file, prepare?.job, prepare?.triggers, prepare?.commands, prepare?.tagPrefix];
		},
		value: ['prepare-tool.yml', 'prep', 'dispatchOnly', 'cargo check', 'tool-v'],
	},
	{
		flags: ['prepare-publication-steps', 'prepare-credentials', 'prepare-binaries'],
		args: [
			'--prepare-file',
			'prepare-tool.yml',
			'--prepare-publication-steps',
			'{}',
			'--prepare-credentials',
			'{"CARGO_REGISTRY_TOKEN":"crates-io"}',
			'--prepare-binaries',
			JSON.stringify({ builds: [build], targets: ['linux-amd64'] }),
		],
		read: c => {
			const prepare = main(c).prepare;
			return [prepare?.publicationSteps, prepare?.credentials, prepare?.binaries];
		},
		value: [{}, { CARGO_REGISTRY_TOKEN: 'crates-io' }, { builds: [build], targets: ['linux-amd64'] }],
	},
	{
		flags: ['promote-file', 'promote-job', 'promote-triggers', 'promote-commands', 'promote-tag-prefix'],
		args: [
			'--promote-file',
			'publish-tool.yml',
			'--promote-job',
			'ship',
			'--promote-triggers',
			'dispatchOnly',
			'--promote-commands',
			'cargo publish',
			'--promote-tag-prefix',
			'tool-v',
		],
		read: c => {
			const promote = main(c).promote;
			return [promote?.file, promote?.job, promote?.triggers, promote?.commands, promote?.tagPrefix];
		},
		value: ['publish-tool.yml', 'ship', 'dispatchOnly', 'cargo publish', 'tool-v'],
	},
	{
		flags: ['promote-publication-steps', 'promote-credentials'],
		args: ['--promote-publication-steps', '{}', '--promote-credentials', '{"CARGO_REGISTRY_TOKEN":"crates-io"}'],
		read: c => [main(c).promote?.publicationSteps, main(c).promote?.credentials],
		value: [{}, { CARGO_REGISTRY_TOKEN: 'crates-io' }],
	},
	{
		flags: ['binary', 'target'],
		args: ['--binary', 'tool', '--target', 'linux-amd64', '--target', 'windows-amd64'],
		read: c => main(c).promote?.binaries,
		value: { builds: [build], targets: ['linux-amd64', 'windows-amd64'] },
	},
	{
		flags: ['actions-revision'],
		args: ['--actions-revision', 'v1.2.3'],
		read: c => c.actionsRevision,
		value: 'v1.2.3',
	},
];

test('every setup flag sets its field in the previewed plan', async () => {
	tool();
	const proposal = await preview([]);
	for (const entry of cases) {
		const plan = await preview([...(entry.args.includes('--promote-file') ? [] : promote), ...entry.args]);
		expect([entry.flags, entry.read(plan.choices)]).toEqual([entry.flags, entry.value]);
		expect(entry.read(proposal.choices)).not.toEqual(entry.value);
	}
	const covered = new Set(cases.flatMap(entry => entry.flags));
	expect(setupFlagPaths.flatMap(entry => entry.names).filter(name => !covered.has(name))).toEqual([]);
});

test('every setup schema field has a declared adopt flag', () => {
	expect(Object.keys(choicesFlagKinds).sort()).toEqual([...choicesFields].sort());
	expect(Object.keys(streamFlagKinds).sort()).toEqual([...streamFields].sort());
	expect(Object.keys(workflowFlagKinds).sort()).toEqual([...workflowFields].sort());
	const paths = setupFlagPaths.map(entry => entry.path);
	for (const field of choicesFields) expect(paths).toContain(field);
	for (const field of streamFields.filter(field => field !== 'prepare' && field !== 'promote')) {
		expect(paths).toContain(field);
	}
	for (const role of ['prepare', 'promote']) {
		for (const field of workflowFields) expect(paths).toContain(`${role}.${field}`);
	}
	for (const name of ['adopt', 'repositories']) {
		const command = app.schema.commands.find(entry => entry.name === name);
		const adopt = name === 'adopt' ? command : command?.commands.find(entry => entry.name === 'adopt');
		const declared = Object.keys(adopt?.flags ?? {});
		expect(setupFlagPaths.flatMap(entry => entry.names).filter(flag => !declared.includes(flag))).toEqual([]);
	}
});

test('setup flags reject values outside their enums and invalid JSON', async () => {
	tool();
	const bump = await app.execute(['adopt', 'octo/tool', '--bump', 'sideways'], { isTTY: false, env: {} });
	expect(bump.exitCode).not.toBe(0);
	expect(bump.stderr.join('')).toContain('sideways');
	const target = await app.execute(['adopt', 'octo/tool', '--binary', 'tool', '--target', 'plan9-amd64'], {
		isTTY: false,
		env: {},
	});
	expect(target.exitCode).not.toBe(0);
	expect(target.stderr.join('')).toContain('plan9-amd64');
	const json = await app.execute(['adopt', 'octo/tool', '--needs', '{'], { isTTY: false, env: {} });
	expect(json.exitCode).not.toBe(0);
	expect(json.stderr.join('')).toContain('--needs is not valid JSON');
	const unknown = await app.execute(['adopt', 'octo/tool', '--package', 'nope'], { isTTY: false, env: {} });
	expect(unknown.exitCode).not.toBe(0);
	expect(unknown.stderr.join('')).toContain('--package nope is not a discovered package');
	const binary = await app.execute(['adopt', 'octo/tool', ...promote, '--binary', 'other'], { isTTY: false, env: {} });
	expect(binary.exitCode).not.toBe(0);
	expect(binary.stderr.join('')).toContain('--binary other is not a binary of main');
	const workflowless = await app.execute(['adopt', 'octo/tool', '--promote-job', 'ship'], { isTTY: false, env: {} });
	expect(workflowless.exitCode).not.toBe(0);
	expect(workflowless.stderr.join('')).toContain('--promote-file: Invalid input');
	const prefix = await app.execute(['adopt', 'octo/tool', ...promote, '--promote-tag-prefix', 'bad prefix'], {
		isTTY: false,
		env: {},
	});
	expect(prefix.exitCode).not.toBe(0);
	expect(prefix.stderr.join('')).toContain('--promote-tag-prefix');
});

test('flags given with --choices override only their fields', async () => {
	tool();
	const proposal = await preview([]);
	const stream = { ...main(proposal.choices), approval: 'required', bump: 'pr', start: ['dashboard'] };
	const file = join(directory, 'choices.json');
	await Bun.write(file, JSON.stringify({ ...proposal.choices, streams: [stream] }));
	const plan = await preview(['--choices', file, '--bump', 'commit', '--start', 'cli']);
	expect(main(plan.choices)).toEqual(main(setupChoicesSchema.parse({
		streams: [{ ...stream, bump: 'commit', start: ['cli'] }],
	})));
	const refused = await app.execute(['adopt', 'octo/tool', '--plan', file, '--apply', '--bump', 'commit'], {
		isTTY: false,
		env: {},
	});
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain('without --choices or setup flags');
});

test('a fully flagged adopt in a terminal asks no question and opens the setup PR', async () => {
	const repository = tool();
	const result = await app.execute(
		['adopt', 'octo/tool', ...promote, '--start', 'cli', '--bump', 'commit', '--approval', 'merge', '--binary', 'tool'],
		{ prompter: silent, isTTY: true, env: {} },
	);
	expect([result.exitCode, result.stderr.join('')]).toEqual([0, '']);
	expect(result.stdout.join('')).toContain('Setup PR: https://github.com/octo/tool/pull/1');
	const body = repository.pulls[0]?.body ?? '';
	expect(body).not.toContain('tick when a version raised without a start publishes');
	expect(body).not.toContain('tick how a version bump reaches the default branch');
	const configuration = z.object({
		streams: z.object({
			main: z.object({
				start: z.array(z.looseObject({ via: z.string() })),
				prepare: z.looseObject({ bump: z.string() }),
				promote: z.looseObject({ approval: z.string() }),
			}),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	expect(configuration.streams.main.start.map(start => start.via)).toEqual(['cli']);
	expect(configuration.streams.main.prepare.bump).toBe('commit');
	expect(configuration.streams.main.promote.approval).toBe('merge');
	world.github.merge(repository, 1);
	const again = await app.execute(
		['adopt', 'octo/tool', ...promote, '--start', 'cli', '--bump', 'commit', '--approval', 'merge', '--binary', 'tool'],
		{ prompter: silent, isTTY: true, env: {} },
	);
	expect([again.exitCode, again.stderr.join('')]).toEqual([0, '']);
	expect(again.stdout.join('')).toContain('Release setup already matches.');
	expect(repository.pulls).toHaveLength(1);
});

test('flagged adopt saves a reviewable plan and stops on blockers', async () => {
	const repository = tool();
	const output = join(directory, 'plan.json');
	const saved = await app.execute(['adopt', 'octo/tool', ...promote, '--bump', 'commit', '--output', output], {
		prompter: silent,
		isTTY: true,
		env: {},
	});
	expect([saved.exitCode, saved.stderr.join('')]).toEqual([0, '']);
	expect(saved.stdout.join('')).toContain(`Open the setup PR with: beepboop adopt octo/tool --plan ${output} --apply`);
	expect(main(previewed.parse(await Bun.file(output).json()).choices).bump).toBe('commit');
	expect(repository.pulls).toHaveLength(0);
	const blocked = await app.execute(['adopt', 'octo/tool', '--bump', 'commit'], {
		prompter: silent,
		isTTY: true,
		env: {},
	});
	expect(blocked.exitCode).toBe(1);
	expect(blocked.stdout.join('')).toContain('main: select a publication workflow.');
	expect(repository.pulls).toHaveLength(0);
});

test('fields given by no flag stay unanswered in the setup PR', async () => {
	const repository = tool();
	const result = await app.execute(['adopt', 'octo/tool', ...promote, '--bump', 'commit'], {
		prompter: silent,
		isTTY: true,
		env: {},
	});
	expect([result.exitCode, result.stderr.join('')]).toEqual([0, '']);
	expect(result.stdout.join('')).toContain(
		'main: tick when a version raised without a start publishes. Until you do, Beepboop waits for your approval.',
	);
	const configuration = JSON.parse(
		world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}',
	);
	const stream = z.object({ streams: z.object({ main: z.looseObject({ promote: z.looseObject({}) }) }) }).parse(
		configuration,
	).streams.main;
	expect(stream.promote).not.toHaveProperty('approval');
	expect(stream).not.toHaveProperty('start');
});

const shells = ['bash', 'zsh', 'fish'] as const;
function offered(shell: (typeof shells)[number], flag: string): string[] {
	const script = generateCompletion(app.schema, shell);
	if (shell === 'zsh') {
		return new RegExp(String.raw`'--${flag}\[[^\]]*\]:value:\(([^)]*)\)'`).exec(script)?.[1]?.split(' ') ?? [];
	}
	if (shell === 'bash') {
		return new RegExp(String.raw`--${flag}\)\n\t+COMPREPLY=\(\$\(compgen -W '([^']*)'`).exec(script)?.[1]?.split(' ')
			?? [];
	}
	return [
		...new Set(
			[...script.matchAll(new RegExp(String.raw`path_is adopt" -l ${flag} .* -a (\S+)$`, 'gm'))].map(match =>
				match[1] ?? ''
			),
		),
	];
}

test('completion scripts list every setup flag and the values of each single-value enum flag', () => {
	for (const shell of shells) {
		const script = generateCompletion(app.schema, shell);
		for (const flag of setupFlagPaths.flatMap(entry => entry.names)) expect(script).toContain(`-${flag}`);
		for (
			const [flag, values] of [
				['versioning', streamVersionings],
				['bump', versionBumps],
				['approval', approvalPolicies],
				['prepare-triggers', workflowTriggers],
				['promote-triggers', workflowTriggers],
			] as const
		) {
			expect([shell, flag, offered(shell, flag)]).toEqual([shell, flag, [...values]]);
		}
	}
});

test.failing('completion scripts list the values of repeatable enum flags (kjanat/dreamcli#199)', () => {
	for (const shell of shells) {
		for (const [flag, values] of [['start', startChannels], ['target', binaryTargets]] as const) {
			expect([shell, flag, offered(shell, flag)]).toEqual([shell, flag, [...values]]);
		}
	}
});

async function refused(args: string[], message: string) {
	const result = await app.execute(['adopt', ...args], { isTTY: false, env: {} });
	expect([result.exitCode === 0, result.stderr.join('')]).toEqual([false, expect.stringContaining(message)]);
}

test('setup flags name what they cannot resolve', async () => {
	tool();
	const proposal = await preview(promote);
	const file = join(directory, 'two.json');
	await Bun.write(
		file,
		JSON.stringify({ streams: [main(proposal.choices), { ...main(proposal.choices), name: 'second' }] }),
	);
	await refused(['octo/tool', '--choices', file, '--bump', 'commit'], 'Name the release group these flags change');
	const broken = join(directory, 'broken.json');
	await Bun.write(broken, JSON.stringify({ streams: 'all' }));
	await refused(['octo/tool', '--choices', broken, '--bump', 'commit'], `--choices ${broken}: streams:`);
	await refused(['octo/tool', ...promote, '--target', 'linux-amd64'], '--target needs --binary');
	await refused(['octo/tool', '--actions-revision', 'latest'], '--actions-revision:');
	world.github.create('octo/twin', {
		'Cargo.toml': '[package]\nname = "twin"\nversion = "1.0.0"\nedition = "2024"\n',
		'js/package.json': '{"name":"twin","version":"1.0.0"}',
	});
	await refused(['octo/twin', '--package', 'twin'], '--package twin names several packages');
});

test('a flagged new workflow needs commands Beepboop cannot generate and a job it cannot infer', async () => {
	world.github.create('octo/generated', {
		'Cargo.toml': '[workspace]\nmembers = []\n[workspace.package]\nversion = "1.0.0"\n',
		'npm/targets.json': JSON.stringify({
			scope: '@octo',
			facade: '@octo/widget',
			targets: [{ pkg: 'widget-linux-x64' }],
		}),
	});
	await refused(['octo/generated', '--promote-file', 'release.yml'], 'Give them with --promote-commands');
	const commanded = await app.execute(
		['adopt', 'octo/generated', '--json', '--promote-file', 'release.yml', '--promote-commands', './publish.sh'],
		{ isTTY: false, env: {} },
	);
	expect(commanded.exitCode).toBe(0);
	expect(previewed.parse(JSON.parse(commanded.stdout.join(''))).choices.streams[0]?.promote).toMatchObject({
		file: 'release.yml',
		job: 'publish',
		commands: './publish.sh',
	});
	world.github.create('octo/packages', {
		'packages/a/package.json': '{"name":"package-a","version":"1.0.0"}',
		'.github/workflows/ship.yml':
			'name: Ship\non: workflow_dispatch\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n',
	});
	await refused(['octo/packages', '--promote-file', 'ship.yml'], '--promote-job names the job in ship.yml');
	const shipped = await app.execute(
		['adopt', 'octo/packages', '--json', '--promote-file', 'ship.yml', '--promote-job', 'ship'],
		{ isTTY: false, env: {} },
	);
	expect(shipped.exitCode).toBe(0);
	expect(previewed.parse(JSON.parse(shipped.stdout.join(''))).choices.streams[0]?.promote).toMatchObject({
		file: 'ship.yml',
		job: 'ship',
		commands: 'beepboop publish',
	});
});
