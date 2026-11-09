import { beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PromptEngine, ResolvedPromptConfig } from '@kjanat/dreamcli';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import { plugin, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { z } from 'zod';
import { parseSetupPlan } from '@/automation/setup-plan';
import { app } from '@/cli/cli';
import type { Client } from '@/cli/client';
import { routes } from '@/contract/routes';

let world: World;
let directory: string;
let client: Client;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-adopt-', created => {
	directory = created;
});
beforeEach(async () => {
	({ client } = await savedClient(world, directory));
});
const run = (args: string[], answers?: unknown[]) => runCli(['repositories', ...args], answers);

const proposalPrompt = 'Open or refresh the setup PR with this proposal? Answer no to choose the setup yourself.';

function defaults(overrides: Record<string, string> = {}, confirmations: Record<string, boolean> = {}) {
	const prompts: ResolvedPromptConfig[] = [];
	const prompter: PromptEngine = {
		async promptOne(config) {
			prompts.push(config);
			if (config.kind === 'select') {
				return { answered: true, value: overrides[config.message] ?? config.choices[0].value };
			}
			if (config.kind === 'confirm') {
				return {
					answered: true,
					value: confirmations[config.message] ?? (config.message === proposalPrompt ? false : config.default ?? true),
				};
			}
			if (config.kind === 'input') return { answered: true, value: '' };
			throw new Error(`Unexpected prompt: ${config.message}`);
		},
	};
	return { prompts, prompter };
}

async function review(repository: string, choices: string, output: string): Promise<void> {
	expect((await run(['adopt', repository, '--choices', choices, '--output', output, '--json'])).exitCode).toBe(0);
}

async function applyReview(repository: string, output: string) {
	const applied = await run(['adopt', repository, '--plan', output, '--apply', '--json']);
	expect(applied.exitCode).toBe(0);
	return applied;
}

async function propose(repository: string, choices: unknown) {
	const file = join(directory, 'choices.json'), output = join(directory, 'review.json');
	await Bun.write(file, JSON.stringify(choices));
	await review(repository, file, output);
	await applyReview(repository, output);
	return file;
}

test('adopt enrolls a repository, reviews generated files and only opens a PR after confirmation', async () => {
	const repository = widget(world.github, { configured: false });
	const original = world.github.head(repository);
	const declined = await run(['adopt', repository.name], [false, 'new', '', 'managed', false, false]);
	expect(declined.exitCode).toBe(0);
	expect(declined.stdout.join('')).toContain('release-widget.yml');
	expect(repository.pulls).toHaveLength(0);
	expect((await Effect.runPromise(client.call(routes.repositoriesList, {}))).map(row => row.name)).toContain(
		repository.name,
	);
	const accepted = await run(
		['adopt', `https://github.com/${repository.name}`],
		[false, 'new', '', 'managed', false, true],
	);
	expect(accepted.exitCode).toBe(0);
	expect(repository.pulls).toHaveLength(1);
	expect(world.github.head(repository)).toBe(original);
	expect(world.github.file(repository, '.github/workflows/release-widget.yml', 'automation/onboarding')).toContain(
		'uses: kjanat/beepboop/actions/publish@v1',
	);
	expect(accepted.stdout.join('')).toContain('/pull/1');
	expect(world.github.resolve(repository, 'automation/onboarding').message).toContain(
		'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>',
	);
	world.github.merge(repository, 1);
	const reopened = await run(['setup', repository.name], ['release-widget.yml', 'managed', false]);
	expect(reopened.exitCode).toBe(0);
	expect(reopened.stdout.join('')).toContain('Release setup already matches.');
});

test('Cargo adoption generates one workflow and advanced renaming keeps the shared binding', async () => {
	const repository = world.github.create('octo/crates', {
		'Cargo.toml': '[package]\nname = "my-crate"\nversion = "1.0.0"\nedition = "2024"\n',
		'Cargo.lock': '# Lockfile\n',
	});
	const result = await run(
		['adopt', repository.name],
		[false, 'new', '', 'same', '', true, false, 'workspace', 'my-release.yml', '', true],
	);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.join('')).toContain('Cargo.lock must be updated');
	const source = world.github.file(repository, '.github/workflows/my-release.yml', 'automation/onboarding') ?? '';
	expect(source).toContain('uses: kjanat/beepboop/actions/publish@v1');
	expect(source).toContain(`credentials: '{"CARGO_REGISTRY_TOKEN":"crates-io"}'`);
	expect(source).toContain("inputs.beepboop_operation == 'prepare'");
	expect(source).toContain("inputs.beepboop_operation == 'publish'");
	expect(world.github.file(repository, '.github/workflows/release-my-crate.yml', 'automation/onboarding'))
		.toBeUndefined();
	const binding = z.object({ workflow: z.object({ file: z.string() }) });
	const config = z.object({ streams: z.object({ main: z.object({ prepare: binding, promote: binding }) }) }).parse(
		JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'),
	);
	expect(config.streams.main.prepare.workflow.file).toBe('my-release.yml');
	expect(config.streams.main.promote.workflow.file).toBe('my-release.yml');
	const refreshed = await run(['adopt', repository.name], [false, 'new', '', 'same', '', false, true]);
	expect(refreshed.exitCode).toBe(0);
	expect(repository.pulls).toHaveLength(1);
	expect(world.github.file(repository, '.github/workflows/my-release.yml', 'automation/onboarding')).toBe(source);
});

test('existing steps are explicitly mapped per package and new commands cover only unmapped packages', async () => {
	const repository = world.github.create('octo/packages', {
		'packages/a/package.json': '{"name":"package-a","version":"1.0.0"}',
		'packages/b/package.json': '{"name":"package-b","version":"1.0.0"}',
		'.github/workflows/ship.yml': `name: Ship
on: workflow_dispatch
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  ship:
    runs-on: ubuntu-latest
    steps:
      - id: publish_a
        name: Publish A
        run: ./scripts/publish-a.sh
`,
	});
	const result = await run(
		['adopt', repository.name],
		[true, 'ship.yml', 'ship', 'publish_a', '', '', 'managed', false, true],
	);
	expect(result.exitCode).toBe(0);
	const workflow = z.object({
		jobs: z.object({
			ship: z.object({
				steps: z.array(
					z.object({
						id: z.string().optional(),
						run: z.string().optional(),
						uses: z.string().optional(),
						with: z.object({ publications: z.string().optional() }).passthrough().optional(),
					}).passthrough(),
				),
			}),
		}),
	}).parse(parse(world.github.file(repository, '.github/workflows/ship.yml', 'automation/onboarding') ?? ''));
	const steps = workflow.jobs.ship.steps;
	expect(steps.find(step => step.id === 'beepboop_publish')?.uses).toBe('kjanat/beepboop/actions/publish@v1');
	const publications = z.array(z.object({ name: z.string(), outcome: z.string() })).parse(
		JSON.parse(steps.find(step => step.with?.publications)?.with?.publications ?? '[]'),
	);
	expect(publications.map(pkg => [pkg.name, pkg.outcome])).toEqual([
		['package-a', "${{ steps.publish_a.outcome == 'success' && 'succeeded' || 'failed' }}"],
	]);
});

for (const mixed of ['pypi', 'npm'] as const) {
	test(`a cargo and ${mixed} selection adopts with generated commands and no commands prompt`, async () => {
		const repository = world.github.create('octo/mixed', {
			'Cargo.toml': '[package]\nname = "mixed-cli"\nversion = "1.0.0"\nedition = "2024"\n',
			...(mixed === 'pypi'
				? { 'bench/pyproject.toml': '[project]\nname = "mixed-bench"\nversion = "1.0.0"\n' }
				: { 'js/package.json': '{"name":"mixed-js","version":"1.0.0"}' }),
		});
		const result = await run(['adopt', repository.name], [true, 'new', 'managed', false, true]);
		expect(result.stdout.join('')).not.toContain('Bash commands');
		expect(result.exitCode).toBe(0);
		const workflow = z.object({
			jobs: z.object({
				publish: z.object({
					steps: z.array(z.looseObject({ id: z.string().optional(), uses: z.string().optional() })),
				}),
			}),
		}).parse(
			parse(world.github.file(repository, '.github/workflows/release-mixed.yml', 'automation/onboarding') ?? ''),
		);
		const steps = workflow.jobs.publish.steps;
		expect(steps.find(step => step.id === 'beepboop_publish')).toEqual({
			id: 'beepboop_publish',
			name: 'Publish selected packages',
			uses: 'kjanat/beepboop/actions/publish@v1',
			with: {
				'execution-id': '${{ steps.beepboop.outputs.execution-id }}',
				credentials: '{"CARGO_REGISTRY_TOKEN":"crates-io"}',
			},
		});
		expect(steps.map(step => step.uses).filter(uses => uses?.includes('actions/report'))).toEqual([]);
	});
}

test('adoption stops when no commands are entered for packages without generated commands', async () => {
	const repository = world.github.create('octo/generated', {
		'Cargo.toml': '[workspace]\nmembers = []\n[workspace.package]\nversion = "1.0.0"\n',
		'npm/targets.json': JSON.stringify({
			scope: '@octo',
			facade: '@octo/widget',
			targets: [{ pkg: 'widget-linux-x64' }],
		}),
	});
	const result = await run(['adopt', repository.name], [true, 'new', '']);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.join('')).toContain('No build and publish commands for');
	expect(repository.pulls).toEqual([]);
});

test('generated npm targets require explicit commands instead of an npm publish suggestion', async () => {
	const repository = world.github.create('octo/generated', {
		'Cargo.toml': '[workspace]\nmembers = []\n[workspace.package]\nversion = "1.0.0"\n',
		'npm/targets.json': JSON.stringify({
			scope: '@octo',
			facade: '@octo/widget',
			targets: [{ pkg: 'widget-linux-x64' }],
		}),
	});
	const result = await run(
		['adopt', repository.name],
		[true, 'new', './scripts/generate-and-publish.sh', '', 'managed', false, true],
	);
	expect(result.exitCode).toBe(0);
	const workflow = world.github.file(repository, '.github/workflows/release-generated.yml', 'automation/onboarding')
		?? '';
	expect(workflow).toContain('./scripts/generate-and-publish.sh');
	expect(workflow).not.toContain('npm publish');
});

test('scripted adoption previews choices and applies only the saved review, refusing stale and foreign plans', async () => {
	const repository = widget(world.github, { configured: false });
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	await Bun.write(
		choices,
		JSON.stringify({
			streams: [{
				name: 'main',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				versioning: 'workspace',
				promote: { file: 'release.yml', commands: 'npm publish' },
			}],
		}),
	);
	await review(repository.name, choices, output);
	const plan = await Effect.runPromise(parseSetupPlan(await Bun.file(output).json()));
	expect(plan.blockers).toEqual([]);
	expect(repository.pulls).toHaveLength(0);
	const invalid = await run(['adopt', repository.name, '--apply', '--choices', choices]);
	expect(invalid.exitCode).not.toBe(0);
	expect(invalid.stderr.join('')).toContain('--apply needs --plan');
	const foreign = await run(['adopt', 'octo/other', '--plan', output, '--apply']);
	expect(foreign.exitCode).not.toBe(0);
	expect(foreign.stderr.join('')).toContain('another repository');
	world.github.push(repository, { 'README.md': '# Changed\n' }, 'Change source after review');
	const stale = await run(['adopt', repository.name, '--plan', output, '--apply']);
	expect(stale.exitCode).not.toBe(0);
	expect(repository.pulls).toHaveLength(0);
	expect(stale.stderr.join('')).toContain(
		`The default branch moved to ${world.github.head(repository)}. Preview again.`,
	);
	await review(repository.name, choices, output);
	const applied = await applyReview(repository.name, output);
	expect(repository.pulls).toHaveLength(1);
	expect(JSON.parse(applied.stdout.join(''))).toHaveProperty('url');
});

function bindingsRepository() {
	return world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n[workspace.package]\nversion = "1.0.0"\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml': '[package]\nname = "lint"\nversion.workspace = true\n',
		'bindings/js/package.json': '{"name":"@octo/lint","version":"1.0.0"}\n',
		'bindings/python/pyproject.toml': '[project]\nname = "lint"\nversion = "1.0.0"\n',
		'mise.toml': '[tools]\nrust = "stable"\n',
		'.github/workflows/release.yml': `name: Release
on:
  push:
    tags: ['lint-v*']
jobs:
  npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm publish
        working-directory: bindings/js
`,
	});
}
const bindingsChoices = {
	streams: [{
		name: 'main',
		packages: ['pkg:cargo/lint-core', 'pkg:cargo/lint'],
		required: ['pkg:cargo/lint-core', 'pkg:cargo/lint'],
		versioning: 'workspace',
		observe: [{
			name: 'release',
			file: 'release.yml',
			ref: 'refs/tags/lint-v*',
			publications: ['pkg:npm/%40octo/lint'],
		}],
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
		versionFiles: [
			{ path: 'bindings/js/package.json', format: 'json', key: ['version'] },
			{ path: 'bindings/python/pyproject.toml', format: 'toml', key: ['project', 'version'] },
		],
	}],
};

test('a saved plan with version files, credentials, a tag prefix and observed workflows applies unchanged', async () => {
	const repository = bindingsRepository();
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	await Bun.write(choices, JSON.stringify(bindingsChoices));
	await review(repository.name, choices, output);
	const plan = await Effect.runPromise(parseSetupPlan(await Bun.file(output).json()));
	expect(plan.blockers).toEqual([]);
	expect(plan.choices.streams[0]?.versionFiles).toHaveLength(2);
	const applied = await applyReview(repository.name, output);
	expect(applied.stderr.join('')).toBe('');
	expect(repository.pulls).toHaveLength(1);
});

test('setup PRs and their refreshes are assigned to the owner with a review request', async () => {
	const repository = bindingsRepository();
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	await Bun.write(choices, JSON.stringify(bindingsChoices));
	const apply = async () => {
		await review(repository.name, choices, output);
		await applyReview(repository.name, output);
	};
	await apply();
	const [pull] = repository.pulls;
	expect({ assignees: pull?.assignees, reviewers: pull?.reviewers }).toEqual({
		assignees: ['octo'],
		reviewers: ['octo'],
	});
	if (pull) {
		pull.assignees = [];
		pull.reviewers = [];
	}
	await apply();
	expect(repository.pulls).toHaveLength(1);
	expect({ assignees: pull?.assignees, reviewers: pull?.reviewers }).toEqual({
		assignees: ['octo'],
		reviewers: ['octo'],
	});
});

const lintSummary = [
	'Release group lint:',
	'- After you approve a release, release-lint.yml (new) pushes the tag lint-v<version>.',
	'- Tags matching lint-v* start release.yml. It publishes @octo/lint to npm, and Beepboop records each run. Its triggers stay as they are.',
	'- After release.yml succeeds, publish-crates.yml (new) publishes lint and lint-core to crates.io.',
	'- prepare-release.yml (new) runs `cargo update --workspace` and `cargo test --workspace --locked` in the version PR.',
	'- Publication order:',
	'  1. @octo/lint to npm',
	'  2. In parallel: lint and lint-core to crates.io',
];

function lintProposal(repository: { name: string }, sha: string) {
	return [
		`Proposed setup for ${repository.name} at ${sha}:`,
		...lintSummary,
		'The setup PR writes .github/beepboop.json, .github/workflows/prepare-release.yml, .github/workflows/release-lint.yml and .github/workflows/publish-crates.yml.',
		'lint (crates/cli/Cargo.toml) lacks README, description, license, a license file, repository. Beepboop holds its release until the package has them.',
		'lint-core (crates/core/Cargo.toml) lacks README, description, license, a license file, repository. Beepboop holds its release until the package has them.',
		'@octo/lint (bindings/js/package.json) lacks README, description, license, a license file, repository. Beepboop holds its release until the package has them.',
		'publish-crates.yml: when the repository owner merges this PR, Beepboop grants it the stored crates-io secret for the crates operation.',
		'Set up registry access and trusted publishing in each registry. The setup PR publishes nothing.',
	];
}

test('a saved preview prints the proposal and how to apply it', async () => {
	const repository = bindingsRepository();
	const output = join(directory, 'plan.json');
	const result = await app.execute(['repositories', 'adopt', repository.name, '--output', output], {
		isTTY: false,
		env: {},
	});
	expect(result.stderr.join('')).toBe('');
	expect(result.exitCode).toBe(0);
	expect(result.stdout.join('').split('\n')).toEqual([
		...lintProposal(repository, world.github.head(repository)),
		`Open the setup PR with: beepboop adopt octo/lint --plan ${output} --apply`,
		'',
	]);
	expect(repository.pulls).toHaveLength(0);
	await applyReview(repository.name, output);
	expect(repository.pulls).toHaveLength(1);
});

test('one adopt in a terminal shows the proposal, asks once and opens the setup PR', async () => {
	const repository = bindingsRepository();
	const session = defaults({}, { [proposalPrompt]: true });
	const result = await app.execute(['adopt', repository.name], { prompter: session.prompter, isTTY: true, env: {} });
	expect(result.stderr.join('')).toBe('');
	expect(result.exitCode).toBe(0);
	expect(session.prompts.map(prompt => prompt.message)).toEqual([proposalPrompt]);
	expect(result.stdout.join('').split('\n')).toEqual([
		...lintProposal(repository, world.github.head(repository)),
		'Setup PR: https://github.com/octo/lint/pull/1',
		'',
	]);
	expect(repository.pulls.map(pull => [pull.state, pull.assignees, pull.reviewers])).toEqual([
		['open', ['octo'], ['octo']],
	]);
	const body = repository.pulls[0]?.body ?? '';
	expect(body).toContain(
		'  - Publication order\n    1. `@octo/lint` on npm\n    2. In parallel: `lint` on crates.io, `lint-core` on crates.io\n',
	);
	expect(body).toContain(
		`## Release plan\n\n### Stream \`lint\`\n\n${
			lintSummary.slice(1).join('\n')
		}\n- Start a release with \`beepboop release\` in a checkout or from the dashboard.`,
	);
	expect(body).toContain('`release-lint.yml`, created by this PR and started only by Beepboop');
	expect(body).not.toContain('git tag');
	expect(body).not.toMatch(/`lint(?:-core)?`: .*no release workflow publishes it/);
});

test('one adopt without arguments or a terminal opens the setup PR for the checkout', async () => {
	const repository = bindingsRepository();
	const checkout = join(directory, 'checkout');
	await mkdir(checkout);
	for (const args of [['init', '-q'], ['remote', 'add', 'origin', 'git@github.com:octo/lint.git']]) {
		expect(Bun.spawnSync(['git', '-C', checkout, ...args]).exitCode).toBe(0);
	}
	const cwd = spyOn(process, 'cwd').mockReturnValue(checkout);
	const result = await app.execute(['adopt'], { isTTY: false, env: {} }).finally(() => cwd.mockRestore());
	expect(result.stderr.join('')).toBe('');
	expect(result.exitCode).toBe(0);
	expect(result.stdout.join('')).toContain('Setup PR: https://github.com/octo/lint/pull/1\n');
	expect(repository.pulls).toHaveLength(1);
	const again = await app.execute(['repo', 'adopt', repository.name], { isTTY: false, env: {} });
	expect(again.exitCode).toBe(0);
	expect(again.stdout.join('')).toContain('Setup PR: https://github.com/octo/lint/pull/1\n');
	expect(repository.pulls).toHaveLength(1);
});

test('applying after the setup PR was closed unmerged opens a new setup PR', async () => {
	const repository = bindingsRepository();
	const output = join(directory, 'plan.json');
	const apply = async () => {
		expect((await app.execute(['repositories', 'adopt', repository.name, '--output', output], { env: {} })).exitCode)
			.toBe(0);
		const applied = await applyReview(repository.name, output);
		expect(applied.stderr.join('')).toBe('');
	};
	await apply();
	const [closed] = repository.pulls;
	if (closed) closed.state = 'closed';
	await apply();
	expect(repository.pulls.map(pull => ({
		number: pull.number,
		state: pull.state,
		assignees: pull.assignees,
		reviewers: pull.reviewers,
	}))).toEqual([
		{ number: 1, state: 'closed', assignees: ['octo'], reviewers: ['octo'] },
		{ number: 2, state: 'open', assignees: ['octo'], reviewers: ['octo'] },
	]);
	await apply();
	expect(repository.pulls).toHaveLength(2);
});

test('a closed setup PR drops its choices and a bare preview proposes afresh', async () => {
	const repository = bindingsRepository();
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	const saved = { streams: [{ ...bindingsChoices.streams[0], versionFiles: [] }] };
	await Bun.write(choices, JSON.stringify(saved));
	await review(repository.name, choices, output);
	await applyReview(repository.name, output);
	const bare = async () => {
		const result = await run(['adopt', repository.name, '--json']);
		expect(result.exitCode).toBe(0);
		return (await Effect.runPromise(parseSetupPlan(JSON.parse(result.stdout.join(''))))).choices.streams[0];
	};
	expect((await bare())?.versionFiles).toEqual([]);
	const [pull] = repository.pulls;
	if (pull) pull.state = 'closed';
	const fresh = await bare();
	expect(fresh?.versionFiles).toBeUndefined();
	expect(fresh?.promote?.tagPrefix).toBe('lint-v');
});

test('a plan with choice fields this CLI does not know asks for an upgrade and sends nothing', async () => {
	const repository = bindingsRepository();
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	await Bun.write(choices, JSON.stringify(bindingsChoices));
	await review(repository.name, choices, output);
	const saved = z.object({ choices: z.object({ streams: z.array(z.record(z.string(), z.unknown())) }) }).passthrough()
		.parse(await Bun.file(output).json());
	const [stream] = saved.choices.streams;
	if (stream) stream.channels = { stable: 'latest' };
	await Bun.write(output, JSON.stringify(saved));
	const applied = await run(['adopt', repository.name, '--plan', output, '--apply']);
	expect(applied.exitCode).not.toBe(0);
	expect(applied.stderr.join('')).toContain(
		'The setup choices contain channels, which this beepboop version does not support. Upgrade beepboop and run the command again.',
	);
	expect(repository.pulls).toHaveLength(0);
});

test('apply names an outdated CLI when the choices it sends no longer match the reviewed plan', async () => {
	const repository = bindingsRepository();
	const choices = join(directory, 'choices.json'), output = join(directory, 'plan.json');
	await Bun.write(choices, JSON.stringify(bindingsChoices));
	await review(repository.name, choices, output);
	const plan = await Effect.runPromise(parseSetupPlan(await Bun.file(output).json()));
	const stripped = { streams: plan.choices.streams.map(({ versionFiles: _, ...stream }) => stream) };
	const refused = await Effect.runPromise(Effect.flip(client.call(routes.setupApply, {
		repository: repository.name,
		choices: stripped,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	})));
	expect(refused.message).toContain('An outdated beepboop CLI drops choice fields it does not know. Upgrade beepboop');
	expect(repository.pulls).toHaveLength(0);
});

test('JSON adoption previews without prompting and help exposes adopt and the setup alias', async () => {
	const repository = widget(world.github, { configured: false });
	const result = await run(['adopt', repository.name, '--json']);
	expect(result.exitCode).toBe(0);
	const plan = await Effect.runPromise(parseSetupPlan(JSON.parse(result.stdout.join(''))));
	expect(plan.repository).toBe(repository.name);
	expect(repository.pulls).toHaveLength(0);
	for (const command of ['adopt', 'setup']) {
		const help = await run([command, '--help']);
		expect(help.exitCode).toBe(0);
		expect(help.stdout.join('')).toContain('--choices');
		expect(help.stdout.join('')).toContain('--plan');
	}
});

for (const scripted of [true, false]) {
	test(`preview does not refresh an existing setup PR after the source changes (scripted=${scripted})`, async () => {
		const repository = widget(world.github, { configured: false });
		const file = await propose(repository.name, {
			streams: [{
				name: 'main',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				versioning: 'workspace',
				promote: { file: 'release.yml', job: 'publish', commands: 'npm publish' },
			}],
		});
		const before = structuredClone(repository.pulls);
		const head = world.github.resolve(repository, 'automation/onboarding').sha;
		world.github.push(repository, { 'README.md': '# Updated default branch\n' }, 'Change source after opening setup');
		const result = scripted
			? await run(['adopt', repository.name, '--choices', file, '--json'])
			: await run(['adopt', repository.name], [false, 'new', '', 'managed', false, false]);
		expect(result.exitCode).toBe(0);
		expect(world.github.resolve(repository, 'automation/onboarding').sha).toBe(head);
		expect(repository.pulls).toEqual(before);
	});
}

test('saved Cargo commands are kept for the same packages and regenerated after changing packages', async () => {
	const repository = world.github.create('octo/crates', {
		'Cargo.toml': '[workspace]\nmembers = ["a", "b"]\n[workspace.package]\nversion = "1.0.0"\n',
		'a/Cargo.toml': '[package]\nname = "crate-a"\nversion.workspace = true\n',
		'b/Cargo.toml': '[package]\nname = "crate-b"\nversion.workspace = true\n',
	});
	await propose(repository.name, {
		streams: [{
			name: 'main',
			packages: ['pkg:cargo/crate-a'],
			required: ['pkg:cargo/crate-a'],
			versioning: 'workspace',
			promote: { file: 'release.yml', job: 'publish', commands: "cargo publish --package 'crate-a' --locked" },
		}],
	});
	const unchanged = await run(['adopt', repository.name], [false, true, 'new', '', 'managed', false, false]);
	expect(unchanged.exitCode).toBe(0);
	expect(unchanged.stdout.join('')).toContain("cargo publish --package 'crate-a' --locked");
	const changed = await run(
		['adopt', repository.name],
		[false, false, ['pkg:cargo/crate-b'], 'new', '', 'managed', false, true],
	);
	expect(changed.exitCode).toBe(0);
	const source = world.github.file(repository, '.github/workflows/release.yml', 'automation/onboarding') ?? '';
	expect(source).toContain('uses: kjanat/beepboop/actions/publish@v1');
	expect(source).not.toContain("'crate-a'");
	const configured = z.object({
		streams: z.object({
			main: z.object({ promote: z.object({ workflow: z.object({ publications: z.array(z.string()) }) }) }),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	expect(configured.streams.main.promote.workflow.publications).toEqual([
		'pkg:cargo/crate-b',
		'github-release:octo/crates',
	]);
});

test('changing publishing-step mappings regenerates commands for the newly unmapped packages', async () => {
	const repository = world.github.create('octo/packages', {
		'packages/a/package.json': '{"name":"package-a","version":"1.0.0"}',
		'packages/b/package.json': '{"name":"package-b","version":"1.0.0"}',
		'.github/workflows/ship.yml':
			'on: workflow_dispatch\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish_existing\n        name: Publish existing package\n        run: ./scripts/publish.sh\n',
	});
	await propose(repository.name, {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/package-a', 'pkg:npm/package-b'],
			required: ['pkg:npm/package-a', 'pkg:npm/package-b'],
			versioning: 'workspace',
			promote: {
				file: 'ship.yml',
				job: 'ship',
				commands: '(cd packages/b && npm publish --access public)',
				publicationSteps: { 'pkg:npm/package-a': 'publish_existing' },
			},
		}],
	});
	const changed = await run(
		['adopt', repository.name],
		[false, true, 'ship.yml', '', 'publish_existing', '', 'managed', false, true],
	);
	expect(changed.exitCode).toBe(0);
	const source = world.github.file(repository, '.github/workflows/ship.yml', 'automation/onboarding') ?? '';
	expect(source).toContain('uses: kjanat/beepboop/actions/publish@v1');
	expect(source).not.toContain('cd packages/b');
	expect(source).toContain('"name": "package-b"');
	expect(source).not.toContain('"name": "package-a"');
});

test('automatic triggers default to review and retain an explicit saved handover', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': '{"name":"widget","version":"1.0.0"}',
		'.github/workflows/ship.yml':
			'on: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - id: publish_existing\n        name: Publish\n        run: npm publish\n',
	});
	const observe = 'ship: use this setup? Answer no to pick the packages and workflows yourself.';
	const initial = defaults({ 'ship: publish packages': 'ship.yml' }, { [observe]: false });
	const blocked = await app.execute(['repositories', 'adopt', repository.name], {
		prompter: initial.prompter,
		isTTY: true,
		env: {},
	});
	expect(blocked.exitCode).toBe(1);
	const trigger = initial.prompts.find(prompt => prompt.message.includes('who starts this workflow'));
	expect(trigger?.kind === 'select' && trigger.choices[0].value).toBe('review');
	expect(repository.pulls).toHaveLength(0);
	expect(
		(await run(
			['adopt', repository.name],
			[false, false, 'ship.yml', 'dispatchOnly', 'publish_existing', 'managed', false, true],
		))
			.exitCode,
	).toBe(0);
	const saved = defaults();
	const reviewed = await app.execute(['repositories', 'adopt', repository.name], {
		prompter: saved.prompter,
		isTTY: true,
		env: {},
	});
	expect(reviewed.exitCode).toBe(0);
	const handover = saved.prompts.find(prompt => prompt.message.includes('who starts this workflow'));
	expect(handover?.kind === 'select' && handover.choices[0].value).toBe('dispatchOnly');
});

test('shared preparation does not ask for a second trigger handover', async () => {
	const repository = world.github.create('octo/crates', {
		'Cargo.toml': '[package]\nname = "my-crate"\nversion = "1.0.0"\n',
		'Cargo.lock': '# Lockfile\n',
	});
	expect((await run(['adopt', repository.name], ['new', '', 'same', '', false, true])).exitCode).toBe(0);
	world.github.merge(repository, 1);
	const source = world.github.file(repository, '.github/workflows/release-my-crate.yml') ?? '';
	world.github.push(
		repository,
		{ '.github/workflows/release-my-crate.yml': source.replace('on:\n', 'on:\n  push:\n') },
		'Add an incompatible automatic trigger',
	);
	const session = defaults();
	const result = await app.execute(['repositories', 'adopt', repository.name], {
		prompter: session.prompter,
		isTTY: true,
		env: {},
	});
	expect(result.exitCode).toBe(1);
	expect(session.prompts.filter(prompt => prompt.message.includes('who starts this workflow'))).toHaveLength(1);
	expect(result.stdout.join('')).toContain('shared workflows need separate preparation and publication jobs');
});

test('an inferred stream is adopted by observing its existing workflow', async () => {
	const repository = plugin(world.github);
	const session = defaults({}, { 'Open or refresh the setup PR with these exact changes?': true });
	const result = await app.execute(['repositories', 'adopt', repository.name], {
		prompter: session.prompter,
		isTTY: true,
		env: {},
	});
	expect(result.exitCode).toBe(0);
	expect(session.prompts.map(prompt => prompt.message)).toContain(
		'main: use this setup? Answer no to pick the packages and workflows yourself.',
	);
	expect(session.prompts.some(prompt => prompt.message.includes('publish packages'))).toBe(false);
	expect(result.stdout.join('')).toContain(
		'Release group main:\n- Tags matching v* start release.yml. It publishes the GitHub release, and Beepboop records each run. Its triggers stay as they are.\n',
	);
	expect(repository.pulls).toHaveLength(1);
	expect(repository.pulls[0]?.body).toContain('## Release plan');
	const config = z.object({
		streams: z.object({
			main: z.object({ workflows: z.record(z.string(), z.object({ mode: z.string(), file: z.string() })) }),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	expect(Object.values(config.streams.main.workflows)).toEqual([
		expect.objectContaining({ mode: 'observe', file: 'release.yml' }),
	]);
	expect(world.github.file(repository, '.github/workflows/release.yml', 'automation/onboarding')).toBe(
		world.github.file(repository, '.github/workflows/release.yml'),
	);
});
