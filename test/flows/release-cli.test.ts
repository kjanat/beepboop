import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import type { PromptEngine } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { z } from 'zod';
import { app } from '@/cli/cli';
import { Client } from '@/cli/client';
import { checkoutRepository } from '@/cli/release';
import { routes } from '@/contract/routes';
import { planReview } from '@/contract/views';
import { passChecks, publishWorkflow, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { origin, World } from '@root/test/support/world.ts';

let world: World, directory: string, client: Client;
const requests: { path: string; body: unknown }[] = [];
const plans: z.output<typeof planReview>[] = [];
beforeEach(async () => {
	world = await World.create();
	directory = await mkdtemp(join(tmpdir(), 'beepboop-release-'));
	client = await Effect.runPromise(Client.at(origin, directory));
	await Effect.runPromise(client.save({ token: await world.cliSession() }));
	spyOn(Client, 'at').mockReturnValue(Effect.succeed(client));
	requests.length = 0;
	plans.length = 0;
	world.network.serve(new URL(origin).host, async request => {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/api/releases/')) requests.push({ path, body: await request.clone().json() });
		const response = await world.handle(request);
		if (path === '/api/releases/plan' && response.ok) plans.push(planReview.parse(await response.clone().json()));
		return response;
	});
});
afterEach(async () => {
	world.dispose();
	await rm(directory, { recursive: true, force: true });
});
const run = (args: string[], answers?: unknown[]) => app.execute(args, { answers, isTTY: true, env: {} });
function git(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(['git', '-C', cwd, ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}
async function checkout(remotes: Record<string, string>) {
	const dir = join(directory, crypto.randomUUID());
	await mkdir(dir);
	git(dir, 'init');
	for (const [name, url] of Object.entries(remotes)) git(dir, 'remote', 'add', name, url);
	return dir;
}
async function seed() {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	return repository;
}
const prepareCalls = () => requests.filter(request => request.path === '/api/releases/prepare');

async function delegated(packages = ['widget'], published: Record<string, string> = { widget: '1.2.3' }) {
	const repository = widget(world.github);
	const configuration = z.looseObject({
		streams: z.looseObject({ main: z.looseObject({ promote: z.looseObject({ workflow: z.looseObject({}) }) }) }),
	}).parse(JSON.parse(widgetConfiguration()));
	configuration.streams.main.prepare = { strategy: 'workflow', workflow: { file: 'prepare.yml' } };
	configuration.streams.main.packages = packages.map(name => `pkg:npm/${name}`);
	configuration.streams.main.required = configuration.streams.main.packages;
	configuration.streams.main.promote.workflow.publications = configuration.streams.main.packages;
	const files: Record<string, string> = {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/prepare.yml': `name: Prepare
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id:
        required: true
        type: string
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/prepare-release.sh
`,
	};
	for (const name of packages.filter(name => name !== 'widget')) {
		files[`packages/${name}/package.json`] = JSON.stringify({ name, version: '1.0.0' });
	}
	for (const [name, version] of Object.entries(published)) world.npm.publish(name, version);
	world.github.push(repository, files, 'Delegate version preparation to a workflow');
	const discovered = await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect(discovered.diagnostics).toEqual([]);
	return { repository, configuration };
}

for (
	const remote of [
		'https://github.com/octo/widget.git',
		'git@github.com:octo/widget.git',
		'ssh://git@github.com/octo/widget.git',
	]
) {
	test(`Git checkout resolution supports ${remote}`, async () => {
		const dir = await checkout({ origin: remote, upstream: 'https://github.com/other/widget.git' });
		expect(await Effect.runPromise(checkoutRepository(dir))).toBe('octo/widget');
	});
}

test('Git remote fallback is unambiguous and failures require an explicit repository', async () => {
	expect(
		await Effect.runPromise(
			checkoutRepository(
				await checkout({ upstream: 'git@github.com:octo/widget.git', backup: 'https://github.com/OCTO/widget.git' }),
			),
		),
	).toBe('octo/widget');
	await expect(
		Effect.runPromise(
			checkoutRepository(
				await checkout({ upstream: 'git@github.com:octo/widget.git', other: 'https://github.com/other/widget.git' }),
			),
		),
	).rejects.toThrow('multiple GitHub repositories');
	await expect(Effect.runPromise(checkoutRepository(await checkout({})))).rejects.toThrow('no Git remotes');
	await expect(Effect.runPromise(checkoutRepository(directory))).rejects.toThrow('current Git checkout');
	await expect(
		Effect.runPromise(
			checkoutRepository(
				await checkout({
					origin: 'https://gitlab.com/octo/widget.git',
					upstream: 'https://github.com/octo/widget.git',
				}),
			),
		),
	).rejects.toThrow('origin remote');
});

test('release resolves this checkout, previews server changes and hands the exact reviewed plan to preparation', async () => {
	const repository = await seed();
	const dir = await checkout({ origin: `git@github.com:${repository.name}.git` });
	await writeFile(join(dir, 'package.json'), '{"name":"local-only","version":"9.9.9"}');
	const before = process.cwd();
	try {
		process.chdir(dir);
		const declined = await run(['release', 'patch'], [false]);
		expect(declined.exitCode).toBe(0);
		expect(declined.stdout.join('')).toContain('widget');
		expect(declined.stdout.join('')).toContain('1.0.1');
		expect(declined.stdout.join('')).toContain(world.github.head(repository));
		expect(declined.stdout.join('')).toContain('Local branch commits and uncommitted files are not included');
		expect(prepareCalls()).toHaveLength(0);
		const accepted = await run(['release', 'patch'], [true]);
		expect(accepted.exitCode).toBe(0);
		expect(accepted.stdout.join('')).toContain('Preparation ');
		expect(accepted.stdout.join('')).toContain('runs approve');
		expect(prepareCalls()).toHaveLength(1);
		expect(prepareCalls()[0]?.body).toEqual({
			repositoryId: repository.id,
			stream: 'main',
			version: { bump: 'patch' },
			sourceSha: plans.at(-1)?.sourceSha,
			planId: plans.at(-1)?.planId,
		});
		expect(repository.pulls).toHaveLength(0);
		expect(world.github.dispatches).toHaveLength(0);
	} finally {
		process.chdir(before);
	}
});

test('JSON previews are read-only and explicit --yes supports unattended preparation outside a checkout', async () => {
	const repository = await seed();
	const preview = await run(['release', 'patch', '--repository', repository.name, '--json']);
	expect(preview.exitCode).toBe(0);
	expect(JSON.parse(preview.stdout.join(''))).toHaveProperty('plan.version', '1.0.1');
	expect(prepareCalls()).toHaveLength(0);
	const prepared = await run(['release', 'patch', '--repository', repository.name, '--json', '--yes']);
	expect(prepared.exitCode).toBe(0);
	expect(JSON.parse(prepared.stdout.join(''))).toHaveProperty('preparation.operation', 'prepare');
	expect(prepareCalls()).toHaveLength(1);
	const missing = await run(['release', '--repository', repository.name, '--json']);
	expect(missing.exitCode).not.toBe(0);
	expect(missing.stdout.join('')).toContain('VERSION_REQUIRED');
	expect(prepareCalls()).toHaveLength(1);
});

test('eligible streams are inferred and ambiguous stream choices describe their packages', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = z.looseObject({ streams: z.record(z.string(), z.unknown()) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.helper = { packages: ['pkg:npm/widget'], prepare: { strategy: 'managed' } };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Add a helper stream');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect((await run(['release', 'patch', '--repository', repository.name, '--json'])).exitCode).toBe(0);
	configuration.streams.second = {
		...z.record(z.string(), z.unknown()).parse(configuration.streams.main),
		promote: { approval: 'required', workflow: { file: 'second.yml', publications: ['pkg:npm/widget'] } },
	};
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/second.yml': publishWorkflow.replace('stream: main', 'stream: second'),
	}, 'Add another release stream');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const ambiguous = await run(['release', 'patch', '--repository', repository.name, '--json']);
	expect(ambiguous.exitCode).not.toBe(0);
	expect(ambiguous.stdout.join('')).toContain('STREAM_REQUIRED');
	const prompts: string[] = [];
	const prompter: PromptEngine = {
		async promptOne(config) {
			if (config.kind === 'select') {
				prompts.push(...config.choices.map(choice => choice.label ?? choice.value));
				return { answered: true, value: 'second' };
			}
			return { answered: true, value: false };
		},
	};
	const selected = await app.execute(['release', 'patch', '--repository', repository.name], {
		prompter,
		isTTY: true,
		env: {},
	});
	expect(selected.exitCode).toBe(0);
	expect(prompts).toContain('second: widget on npm');
	expect(prompts.some(label => label.startsWith('helper'))).toBe(false);
	expect(selected.stdout.join('')).toContain('octo/widget / second');
	expect(prepareCalls()).toHaveLength(0);
});

test('omitted bumps prompt for a meaningful choice and semantic versions remain unchanged', async () => {
	const repository = await seed();
	const result = await run(['release', '--repository', repository.name], ['explicit', 'v1.2.3', false]);
	expect(result.exitCode).toBe(0);
	expect(requests.find(request => request.path === '/api/releases/plan')?.body).toHaveProperty('version', 'v1.2.3');
	const lower = await run([
		'releases',
		'plan',
		repository.name,
		'--stream',
		'main',
		'--releaseVersion',
		'patch',
		'--json',
	]);
	expect(lower.exitCode).toBe(0);
	expect(JSON.parse(lower.stdout.join(''))).toHaveProperty('version', '1.0.1');
});

test('a stale source is refused after confirmation without silently replanning or starting a release', async () => {
	const repository = await seed();
	const prompter: PromptEngine = {
		async promptOne(config) {
			if (config.kind !== 'confirm') throw new Error('Unexpected prompt');
			world.github.push(repository, { 'README.md': '# A different source\n' }, 'Move source after preview');
			return { answered: true, value: true };
		},
	};
	const result = await app.execute(['release', 'patch', '--repository', repository.name], {
		prompter,
		isTTY: true,
		env: {},
	});
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.join('')).toContain('Refresh discovery');
	expect(requests.filter(request => request.path === '/api/releases/plan')).toHaveLength(1);
	expect(prepareCalls()).toHaveLength(1);
	expect(await Effect.runPromise(client.call(routes.executionsList, {}))).toEqual([]);
	expect(repository.pulls).toHaveLength(0);
});

test('independent streams and already-prepared versions cannot accidentally initiate promotion', async () => {
	const repository = await seed();
	world.github.push(repository, {
		'package.json': `${JSON.stringify({ name: 'widget', version: '1.1.0' }, null, 2)}\n`,
	}, 'Versions already prepared');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const existing = await Effect.runPromise(client.call(routes.executionsList, {}));
	const prepared = await run(['release', '1.1.0', '--repository', repository.name, '--yes', '--json']);
	expect(prepared.exitCode).not.toBe(0);
	expect(prepared.stdout.join('')).toContain('ALREADY_PREPARED');
	expect(prepareCalls()).toHaveLength(0);
	expect(await Effect.runPromise(client.call(routes.executionsList, {}))).toEqual(existing);
	const configuration = z.looseObject({ streams: z.record(z.string(), z.unknown()) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.main = {
		...z.record(z.string(), z.unknown()).parse(configuration.streams.main),
		versioning: 'independent',
	};
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Use independent releases');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const independent = await run([
		'release',
		'patch',
		'--repository',
		repository.name,
		'--stream',
		'main',
		'--json',
		'--yes',
	]);
	expect(independent.exitCode).not.toBe(0);
	expect(independent.stdout.join('')).toContain('INDEPENDENT_STREAM');
	expect(prepareCalls()).toHaveLength(0);
});

for (const [bump, version] of [['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']] as const) {
	test(`workflow-delegated ${bump} resolves on the server and prepares its reviewed target`, async () => {
		const { repository } = await delegated();
		const source = world.github.head(repository);
		const preview = await run(['release', bump, '--repository', repository.name, '--json']);
		expect(preview.exitCode).toBe(0);
		const plan = planReview.parse(JSON.parse(preview.stdout.join('')).plan);
		expect(plan.version).toBe(version);
		expect(plan.edits).toEqual([]);
		expect(plan.requiresPreparation).toBe(true);
		expect(prepareCalls()).toHaveLength(0);
		const prepared = await run(['release', bump, '--repository', repository.name], [true]);
		expect(prepared.exitCode).toBe(0);
		expect(prepared.stdout.join('')).toContain(`→ ${version}`);
		expect(prepared.stdout.join('')).toContain('Preparation runs in prepare.yml');
		expect(prepared.stdout.join('')).toContain(
			'when package manifests and configured version files match an unreleased version',
		);
		expect(prepared.stdout.join('')).toContain('If a publication run is created, approve it');
		expect(prepared.stdout.join('')).not.toContain('releases start');
		expect(prepareCalls()[0]?.body).toEqual({
			repositoryId: repository.id,
			stream: 'main',
			version: { bump },
			sourceSha: plan.sourceSha,
			planId: plan.planId,
		});
		const executions = await Effect.runPromise(client.call(routes.executionsList, {}));
		expect(executions.map(execution => ({ operation: execution.operation, version: execution.version }))).toEqual([{
			operation: 'prepare',
			version,
		}]);
		await world.wait(20_000);
		expect(world.github.dispatches.map(dispatch => dispatch.file)).toEqual(['prepare.yml']);
		expect(world.github.head(repository)).toBe(source);
		expect(repository.pulls).toHaveLength(0);
	});
}

test('delegated manifest preparation can promote when its prepared versions reach the default branch', async () => {
	const { repository } = await delegated();
	const prepared = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('Follow it with beepboop runs list');
	expect(prepared.stdout.join('')).not.toContain('releases start');
	await world.wait(20_000);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).toEqual(['prepare.yml']);
	// The repository workflow supplies these generated changes; the CLI does not run it locally.
	const merged = world.github.push(repository, {
		'package.json': `${JSON.stringify({ name: 'widget', version: '1.2.4' }, null, 2)}\n`,
	}, 'Merge the workflow-prepared package version');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const executions = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(executions.filter(execution => execution.operation === 'promote')).toEqual([
		expect.objectContaining({ version: '1.2.4', sourceSha: merged.sha, state: 'awaiting-approval' }),
	]);
});

test('managed manifest plans with custom version files promote after the preparation PR is merged', async () => {
	const repository = await seed();
	const configuration = z.looseObject({ streams: z.looseObject({ main: z.looseObject({}) }) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.main.versionFiles = [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }];
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'VERSION': 'version=1.0.0\n',
	}, 'Keep the custom version file synchronized');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const prepared = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('Version files alone do not start publication');
	expect(prepared.stdout.join('')).toContain('If a publication run is created, approve it');
	expect(prepared.stdout.join('')).not.toContain('releases start');
	expect(plans.at(-1)?.edits.map(edit => edit.path).sort()).toEqual(['VERSION', 'package.json']);
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	expect(world.github.file(repository, 'VERSION', pull.head.sha)).toBe('version=1.0.1\n');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const executions = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(executions.filter(execution => execution.operation === 'promote')).toEqual([
		expect.objectContaining({ version: '1.0.1', sourceSha: merged.sha, state: 'awaiting-approval' }),
	]);
});

test('a version-file-only preparation does not promise or create publication after merge', async () => {
	const packageId = 'pkg:golang/github.com/octo/tagged';
	world.network.serve('proxy.golang.org', () => new Response(null, { status: 404 }));
	const repository = world.github.create('octo/tagged', {
		'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n',
		'VERSION': 'version=1.0.0\n',
		'.github/workflows/publish.yml': publishWorkflow.replaceAll('pkg:npm/widget', packageId),
		'.github/beepboop.json': JSON.stringify({
			managers: ['go', 'workflow'],
			streams: {
				main: {
					packages: [packageId],
					required: [packageId],
					versionFiles: [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }],
					prepare: { strategy: 'managed' },
					promote: {
						approval: 'required',
						workflow: { file: 'publish.yml', publications: [packageId] },
					},
				},
			},
		}),
	});
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const prepared = await run(['release', '1.1.0', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('Version files alone do not start publication');
	expect(prepared.stdout.join('')).toContain(
		'when package manifests and configured version files match an unreleased version',
	);
	expect(prepared.stdout.join('')).not.toContain('releases start');
	expect(plans.at(-1)?.edits.map(edit => edit.path)).toEqual(['VERSION']);
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	expect(world.github.resolve(repository, pull.head.sha).message).toContain(
		'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>',
	);
	world.github.merge(repository, pull.number);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const executions = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(executions.filter(execution => execution.operation === 'promote')).toEqual([]);
});

test('workflow bumps require a known baseline and explicit versions stay delegated', async () => {
	const { repository } = await delegated(['widget'], {});
	const refused = await run(['release', 'patch', '--repository', repository.name, '--yes', '--json']);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stdout.join('')).toContain('explicit version for the first release');
	expect(prepareCalls()).toHaveLength(0);
	const explicit = await run(['release', '4.0.0', '--repository', repository.name, '--json']);
	expect(explicit.exitCode).toBe(0);
	const plan = planReview.parse(JSON.parse(explicit.stdout.join('')).plan);
	expect(plan.version).toBe('4.0.0');
	expect(plan.edits).toEqual([]);
	expect(plan.requiresPreparation).toBe(true);
});

test('workflow bump baselines use only the selected publishable package group', async () => {
	const { repository, configuration } = await delegated(['widget', 'other'], { widget: '1.2.3', other: '2.0.0' });
	const ambiguous = await run(['release', 'minor', '--repository', repository.name, '--yes', '--json']);
	expect(ambiguous.exitCode).not.toBe(0);
	expect(ambiguous.stdout.join('')).toContain('synchronized version group');
	expect(prepareCalls()).toHaveLength(0);
	const explicit = await run(['release', '4.0.0', '--repository', repository.name, '--json']);
	expect(explicit.exitCode).toBe(0);
	expect(planReview.parse(JSON.parse(explicit.stdout.join('')).plan).version).toBe('4.0.0');
	configuration.streams.main.packages = ['pkg:npm/widget'];
	configuration.streams.main.required = ['pkg:npm/widget'];
	configuration.streams.main.promote.workflow.publications = ['pkg:npm/widget'];
	world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Select only widget for this stream',
	);
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const selected = await run(['release', 'minor', '--repository', repository.name, '--json']);
	expect(selected.exitCode).toBe(0);
	expect(planReview.parse(JSON.parse(selected.stdout.join('')).plan).version).toBe('1.3.0');
});

test('workflow tag-derived bumps remain authoritative when registry packages are unpublished', async () => {
	const { repository, configuration } = await delegated(['widget'], {});
	configuration.streams.main.versionSource = { kind: 'tags', prefix: 'v' };
	world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Take release versions from tags',
	);
	repository.refs.set('tags/v2.4.6', world.github.head(repository));
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const preview = await run(['release', 'minor', '--repository', repository.name, '--json']);
	expect(preview.exitCode).toBe(0);
	const plan = planReview.parse(JSON.parse(preview.stdout.join('')).plan);
	expect(plan.version).toBe('2.5.0');
	expect(plan.edits).toEqual([]);
	expect(plan.requiresPreparation).toBe(true);
	const explicit = await run(['release', '3.0.0', '--repository', repository.name, '--json']);
	expect(explicit.exitCode).toBe(0);
	expect(planReview.parse(JSON.parse(explicit.stdout.join('')).plan).version).toBe('3.0.0');
	expect(prepareCalls()).toHaveLength(0);
	const existing = (await Effect.runPromise(client.call(routes.executionsList, {})))
		.filter(execution => execution.operation === 'promote').map(execution => execution.id);
	const prepared = await run(['release', 'minor', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('tag-based streams do not start publication after merge');
	expect(prepared.stdout.join('')).toContain('Starting publication from this preparation is not supported yet');
	expect(prepared.stdout.join('')).not.toContain('releases start');
	expect(prepared.stdout.join('')).not.toContain('runs approve');
	const merged = world.github.push(repository, {
		'package.json': `${JSON.stringify({ name: 'widget', version: '2.5.0' }, null, 2)}\n`,
	}, 'Merge the tag-derived preparation');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const executions = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(executions.filter(execution => execution.operation === 'promote').map(execution => execution.id)).toEqual(
		existing,
	);
});
