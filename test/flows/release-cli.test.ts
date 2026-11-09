import { beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PromptEngine } from '@kjanat/dreamcli';
import { createOutput } from '@kjanat/dreamcli';
import { begin, gitOutput, runAction, runIdentity } from '@root/test/support/actions.ts';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { Repository } from '@root/test/support/github.ts';
import { promotionsOf } from '@root/test/support/releases.ts';
import {
	editableConfiguration,
	npmManifest,
	passChecks,
	publishWorkflow,
	widget,
	widgetConfiguration,
} from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { strip } from 'ansispeck';
import { Effect } from 'effect';
import { z } from 'zod';
import { app } from '@/cli/cli';
import type { Client } from '@/cli/client';
import { checkoutRepository, releaseRepository } from '@/cli/release';
import { routes } from '@/contract/routes';
import { planReview } from '@/contract/views';

let world: World, directory: string, client: Client, token: string;
const requests: { path: string; body: unknown }[] = [];
const plans: z.output<typeof planReview>[] = [];
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-release-', created => {
	directory = created;
});
beforeEach(async () => {
	({ client, token } = await savedClient(world, directory));
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
const run = runCli;
async function checkout(remotes: Record<string, string>) {
	const dir = join(directory, crypto.randomUUID());
	await mkdir(dir);
	gitOutput(dir, ['init']);
	for (const [name, url] of Object.entries(remotes)) gitOutput(dir, ['remote', 'add', name, url]);
	return dir;
}
function seed() {
	return discoveredWidget(world, token);
}
const prepareCalls = () => requests.filter(request => request.path === '/api/releases/prepare');
const streamRecord = z.record(z.string(), z.unknown());
function widgetStreams() {
	return z.looseObject({ streams: streamRecord }).parse(JSON.parse(widgetConfiguration()));
}
function withMain(configuration: ReturnType<typeof widgetStreams>, changes: Record<string, unknown>) {
	return { ...streamRecord.parse(configuration.streams.main), ...changes };
}

async function delegated(packages = ['widget'], published: Record<string, string> = { widget: '1.2.3' }) {
	const repository = widget(world.github);
	const configuration = editableConfiguration();
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
		expect(declined.stdout.join('')).toContain(world.github.head(repository).slice(0, 12));
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

test('command output stays in the command channel when the process runs in a terminal', async () => {
	const repository = await seed();
	const terminal = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
	Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
	try {
		const preview = await run(['release', 'patch', '--repository', repository.name, '--json']);
		expect(JSON.parse(preview.stdout.join(''))).toHaveProperty('plan.version', '1.0.1');
		const shown = await run(['repositories', 'show', repository.name, '--json']);
		expect(JSON.parse(Bun.stripANSI(shown.stdout.join('')))).toHaveProperty('name', repository.name);
	} finally {
		if (terminal) Object.defineProperty(process.stdout, 'isTTY', terminal);
		else Reflect.deleteProperty(process.stdout, 'isTTY');
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
	const configuration = widgetStreams();
	configuration.streams.helper = { packages: ['pkg:npm/widget'], prepare: { strategy: 'managed' } };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Add a helper stream');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect((await run(['release', 'patch', '--repository', repository.name, '--json'])).exitCode).toBe(0);
	configuration.streams.second = withMain(configuration, {
		promote: { approval: 'required', workflow: { file: 'second.yml', publications: ['pkg:npm/widget'] } },
	});
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/second.yml': publishWorkflow.replace('stream: main', 'stream: second'),
	}, 'Add another release stream');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const ambiguous = await run(['release', 'patch', '--repository', repository.name, '--json']);
	expect(ambiguous.exitCode).not.toBe(0);
	expect(ambiguous.stdout.join('')).toContain('STREAM_REQUIRED');
	const headless = await app.execute(['release', 'patch', '--repository', repository.name], { isTTY: false, env: {} });
	expect(headless.exitCode).not.toBe(0);
	expect(headless.stderr.join('')).toContain('Choose a release stream: main, second');
	expect(headless.stderr.join('')).toContain('Pass --stream NAME');
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
		'package.json': npmManifest('widget', '1.1.0'),
	}, 'Versions already prepared');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const existing = await Effect.runPromise(client.call(routes.executionsList, {}));
	const prepared = await run(['release', '1.1.0', '--repository', repository.name, '--yes', '--json']);
	expect(prepared.exitCode).not.toBe(0);
	expect(prepared.stdout.join('')).toContain('ALREADY_PREPARED');
	expect(prepareCalls()).toHaveLength(0);
	expect(await Effect.runPromise(client.call(routes.executionsList, {}))).toEqual(existing);
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, { versioning: 'independent' });
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
		'package.json': npmManifest('widget', '1.2.4'),
	}, 'Merge the workflow-prepared package version');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await promotions()).toEqual([
		expect.objectContaining({ version: '1.2.4', sourceSha: merged.sha, state: 'awaiting-approval' }),
	]);
});

async function tagged(approval: 'required' | 'push' = 'required') {
	const { repository, configuration } = await delegated();
	configuration.streams.main.promote.workflow.refs = { phase: 'version', prefix: 'v' };
	configuration.streams.main.promote.approval = approval;
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Tag each release');
	const before = world.github.head(repository);
	const merged = world.github.push(repository, {
		'package.json': npmManifest('widget', '1.2.4'),
	}, 'Merge the workflow-prepared package version');
	return { repository, before, merged };
}
const promotions = async () => promotionsOf(await Effect.runPromise(client.call(routes.executionsList, {})));

test('a version whose tag targets another commit gets no promotion and a repository warning', async () => {
	const { repository, before, merged } = await tagged();
	repository.refs.set('tags/v1.2.4', before);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await promotions()).toEqual([]);
	const discovered = await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect(discovered.diagnostics).toEqual([]);
	expect(discovered.findings).toEqual([{
		code: 'version-tagged',
		severity: 'warning',
		subject: { kind: 'stream', name: 'main' },
		message: `Version tag v1.2.4 already targets ${
			before.slice(0, 12)
		}, so pkg:npm/widget cannot publish 1.2.4. Release a new version.`,
	}]);
	expect(await promotions()).toEqual([]);
});

test('no approval overrides a version tag on another commit, and the CLI cancels the promotion', async () => {
	const { repository, before, merged } = await tagged();
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const [promotion] = await promotions();
	if (!promotion) throw new Error('No promotion');
	expect(promotion).toEqual(expect.objectContaining({ state: 'awaiting-approval', sourceSha: merged.sha }));
	repository.refs.set('tags/v1.2.4', before);
	const conflict = `Version tag v1.2.4 already targets ${before.slice(0, 12)}`;
	expect(await Effect.runPromise(client.call(routes.executionsApproval, { id: promotion.id }))).toEqual({
		problems: [],
		blocked: [`${conflict}. Release a new version.`],
	});
	const forced = await run(['runs', 'approve', promotion.id, '--sourceSha', merged.sha, '--force']);
	expect(forced.exitCode).not.toBe(0);
	expect(forced.stderr.join('')).toContain(conflict);
	expect((await promotions())[0]?.state).toBe('awaiting-approval');
	const cancelled = await run(['runs', 'cancel', promotion.id, '--json']);
	expect(cancelled.exitCode).toBe(0);
	expect(await promotions()).toEqual([expect.objectContaining({ id: promotion.id, state: 'cancelled' })]);
	expect((await run(['runs', 'cancel', promotion.id])).exitCode).not.toBe(0);
});

test('push approval cancels a promotion once its version tag targets another commit', async () => {
	const { repository, before, merged } = await tagged('push');
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const [promotion] = await promotions();
	expect(promotion).toEqual(expect.objectContaining({ state: 'awaiting-approval', sourceSha: merged.sha }));
	repository.refs.set('tags/v1.2.4', before);
	passChecks(repository, merged.sha);
	await world.wait(60_000);
	expect(await promotions()).toEqual([expect.objectContaining({
		state: 'cancelled',
		reason: `Version tag v1.2.4 already targets ${before.slice(0, 12)}`,
	})]);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).not.toContain('publish.yml');
});

test('a grant the server would refuse fails before any security-key prompt', async () => {
	const repository = widget(world.github, { configured: false });
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const elevated = spyOn(client, 'elevated');
	const refused = await run(['secrets', 'grant', repository.name, 'npm-token', '--stream', 'main']);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain('Repository not configured');
	expect(elevated).not.toHaveBeenCalled();
});

test('an acceptable grant asks for the security key once and stores the grant', async () => {
	const repository = await seed();
	await world.sealCredential('npm-token');
	await world.elevate();
	const elevated = spyOn(client, 'elevated').mockReturnValue(Effect.succeed('proof'));
	const granted = await run(['secrets', 'grant', repository.name, 'npm-token']);
	expect(granted.exitCode).toBe(0);
	expect(elevated).toHaveBeenCalledTimes(1);
	const rows = await world.db.prepare('SELECT alias FROM grants WHERE repository_id=?').bind(repository.id).all();
	expect(rows.results).toEqual([{ alias: 'npm-token' }]);
	expect(granted.stdout.join('')).toBe(
		'Granting octo/widget main/promote access to npm-token.\n✔ octo/widget main/promote can use npm-token.\n',
	);
	expect(granted.activity).toContainEqual({ type: 'spinner:start', text: 'Reading octo/widget' });
	const listed = await run(['secrets', 'list']);
	expect(listed.activity).toContainEqual({ type: 'spinner:start', text: 'Naming the granted repositories' });
	expect(listed.stdout.join('')).toMatch(/npm-token\s+octo\/widget\s+promote\s+runtime/);
	const grant = /([0-9a-f-]{36})\s+npm-token/.exec(listed.stdout.join(''))?.[1] ?? '';
	await world.elevate();
	const revoked = await run(['secrets', 'revoke', grant]);
	expect(revoked.stderr).toEqual([]);
	expect(revoked.stdout.join('')).toBe(`✔ Revoked grant ${grant}.\n`);
	await world.elevate();
	const again = await run(['secrets', 'revoke', grant, '--json']);
	expect(again.exitCode).not.toBe(0);
	expect(JSON.parse(again.stdout.join(''))).toHaveProperty('error.message', 'Unknown grant');
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
	expect(await promotions()).toEqual([
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
	expect(await promotions()).toEqual([]);
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
	const existing = (await promotions()).map(execution => execution.id);
	const prepared = await run(['release', 'minor', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('tag-based streams do not start publication after merge');
	expect(prepared.stdout.join('')).toContain('Starting publication from this preparation is not supported yet');
	expect(prepared.stdout.join('')).not.toContain('releases start');
	expect(prepared.stdout.join('')).not.toContain('runs approve');
	const merged = world.github.push(repository, {
		'package.json': npmManifest('widget', '2.5.0'),
	}, 'Merge the tag-derived preparation');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect((await promotions()).map(execution => execution.id)).toEqual(existing);
});

async function cliStarts() {
	const repository = await seed();
	const configuration = z.looseObject({ streams: z.looseObject({ main: z.looseObject({}) }) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.main.start = [{ via: 'cli' }];
	configuration.streams.main.prepare = { strategy: 'managed', bump: 'commit' };
	configuration.streams.main.credentials = [];
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Start from the CLI',
	);
	passChecks(repository, head.sha);
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	return repository;
}

function releaseRun(repository: Repository) {
	const steps = [
		() => world.wait(16_000),
		async () => {
			passChecks(repository, world.github.head(repository));
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			const run = repository.runs.at(-1);
			const execution = run?.inputs.beepboop_execution_id;
			if (!run || !execution) throw new Error('The release dispatched no run');
			run.status = 'in_progress';
			const identity = runIdentity(repository, run, 'publish.yml');
			await begin(world, identity, execution, 'main', 'promote');
			world.npm.publish('widget', '1.0.1');
			await runAction(world, 'report', identity, {
				EXECUTION_ID: execution,
				PUBLICATIONS: JSON.stringify([
					{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
				]),
			});
			run.status = 'completed';
			run.conclusion = 'success';
			await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	return spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
}

test('release follows a started release through the bump, checks, dispatch and publication', async () => {
	const repository = await cliStarts();
	const declined = await run(['release', 'patch', '--repository', repository.name], [false]);
	expect(declined.stdout.join('')).toContain('Release start cancelled.');
	releaseRun(repository);
	const started = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(started.exitCode).toBe(0);
	const output = started.stdout.join('');
	expect(output).toContain(
		'Beepboop commits the version bump to main, then publishes once that commit is verified and its checks pass.',
	);
	expect(output).toContain('Failing checks or package metadata problems stop the release with a reason.');
	expect(output).not.toContain('runs approve');
	expect(output).toContain(
		'package  registry  version  state      \n-------  --------  -------  -----------\nwidget   npm       1.0.1    ✔ succeeded\n',
	);
	expect(output).toContain(`Run: https://github.com/octo/widget/actions/runs/${repository.runs.at(-1)?.id}\n`);
	const dispatched = repository.runs.at(-1);
	const commit = world.github.resolve(repository, repository.defaultBranch).sha.slice(0, 12);
	const activity = started.activity.map(event =>
		'text' in event ? [event.type, event.text] : 'label' in event ? [event.type, event.label] : [event.type]
	);
	expect(activity).toEqual(expect.arrayContaining([
		['spinner:start', 'Reading octo/widget from Beepboop'],
		['spinner:succeed', 'octo/widget releases from main'],
		['spinner:start', 'Planning patch of octo/widget / main on the server'],
		['spinner:start', 'Starting the release'],
		['spinner:start', 'Applying the 1.0.1 version bump'],
		['spinner:update', `Version commit ${commit} is on main. Waiting for Beepboop to see it`],
		['spinner:succeed', `Release run https://github.com/octo/widget/actions/runs/${dispatched?.id}`],
		['progress:start', 'Publishing'],
	]));
	expect(started.activity).toContainEqual(expect.objectContaining({ type: 'progress:done' }));
	expect(prepareCalls()).toHaveLength(1);
});

test('activity output stays out of JSON output', async () => {
	const repository = await cliStarts();
	const json = await run(['release', 'patch', '--repository', repository.name, '--json', '--yes']);
	expect(json.exitCode).toBe(0);
	expect(JSON.parse(json.stdout.join(''))).toHaveProperty('preparation.operation', 'prepare');
	expect(json.stderr.join('')).not.toContain('Planning');
});

test('--dry-run plans and previews without a prompt or a release', async () => {
	const repository = await cliStarts();
	const previewed = await app.execute(['release', 'patch', '--repository', repository.name, '--dry-run'], {
		isTTY: true,
		env: {},
		prompter: { promptOne: config => Promise.reject(new Error(`Unexpected prompt: ${config.message}`)) },
	});
	expect([previewed.exitCode, previewed.stderr.join('')]).toEqual([0, '']);
	const output = previewed.stdout.join('');
	expect(output).toContain('Release octo/widget / main → 1.0.1');
	expect(output).toContain('package.json\nCurrent:');
	expect(output).toContain('Dry run: Beepboop started nothing.');
	const json = await run(['release', 'patch', '--repository', repository.name, '--dry-run', '--yes', '--json']);
	expect(json.exitCode).toBe(0);
	expect(planReview.parse(JSON.parse(json.stdout.join('')).plan).version).toBe('1.0.1');
	expect(JSON.parse(json.stdout.join(''))).not.toHaveProperty('preparation');
	expect(requests.filter(request => request.path === '/api/releases/plan')).toHaveLength(2);
	expect(prepareCalls()).toHaveLength(0);
	expect(await Effect.runPromise(client.call(routes.executionsList, {}))).toEqual([]);
});

test('an already raised version with the cli start publishes once after one confirmation', async () => {
	const repository = await cliStarts();
	const head = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, head.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const steps = [
		() => world.wait(16_000),
		async () => {
			const dispatched = repository.runs.at(-1);
			const execution = dispatched?.inputs.beepboop_execution_id;
			if (!dispatched || !execution) throw new Error('The release dispatched no run');
			dispatched.status = 'in_progress';
			const identity = runIdentity(repository, dispatched, 'publish.yml');
			await begin(world, identity, execution, 'main', 'promote');
			world.npm.publish('widget', '1.0.1');
			await runAction(world, 'report', identity, {
				EXECUTION_ID: execution,
				PUBLICATIONS: JSON.stringify([
					{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
				]),
			});
			dispatched.status = 'completed';
			dispatched.conclusion = 'success';
			await world.workflowRun(repository, dispatched, 'success', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	const prompts: string[] = [];
	const started = await app.execute(['release', '1.0.1', '--repository', repository.name], {
		isTTY: true,
		env: {},
		prompter: {
			promptOne: config => {
				prompts.push(config.message);
				return Promise.resolve({ answered: true, value: true });
			},
		},
	});
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(prompts).toEqual(['Start this release? The start approves it, and nothing asks for approval afterwards.']);
	const output = started.stdout.join('');
	expect(output).toContain('main already carries 1.0.1. Starting publishes it.');
	expect(output).toContain('Beepboop publishes once the commit is verified and its checks pass.');
	expect(output).toContain('Released 1.0.1 of octo/widget');
	expect(output).not.toContain('runs approve');
	expect(started.activity).toContainEqual({ type: 'spinner:start', text: 'Starting the release of 1.0.1' });
	expect(prepareCalls()).toHaveLength(1);
	expect(world.github.dispatches.filter(dispatch => dispatch.file === 'publish.yml')).toHaveLength(1);
	const promoted = (await promotions()).filter(execution => execution.version === '1.0.1');
	expect(promoted.map(execution => [execution.state, execution.approvedBy])).toEqual([['succeeded', 'start']]);
});

test('activity output stays out of piped output while the release is followed', async () => {
	const repository = await cliStarts();
	releaseRun(repository);
	const piped = await app.execute(['release', 'patch', '--repository', repository.name, '--yes'], {
		isTTY: false,
		env: {},
	});
	expect(piped.exitCode).toBe(0);
	for (const text of [...piped.stdout, ...piped.stderr]) {
		expect(text).not.toContain('Reading octo/widget');
		expect(text).not.toContain('Planning');
	}
});

test('without terminal input the release asks nothing, requires a version and starts after the preview', async () => {
	const repository = await seed();
	const headless = (args: string[], isTTY: boolean) =>
		app.execute(['release', ...args, '--repository', repository.name], { isTTY, env: {} });
	const missing = await headless([], false);
	expect(missing.exitCode).not.toBe(0);
	expect(missing.stderr.join('')).toContain('Choose a release version or bump');
	expect(missing.stderr.join('')).toContain('Pass patch, minor, major or a semantic version');
	expect(prepareCalls()).toHaveLength(0);
	const started = await headless(['patch'], true);
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(started.stdout.join('')).toContain('Release octo/widget / main → 1.0.1');
	expect(prepareCalls()).toHaveLength(1);
});

test('terminal input with piped output still asks before the release starts', async () => {
	const repository = await seed();
	const prompts: string[] = [];
	const prompter: PromptEngine = {
		async promptOne(config) {
			prompts.push(config.message);
			return { answered: true, value: false };
		},
	};
	const piped = await app.execute(['release', 'patch', '--repository', repository.name], {
		prompter,
		isTTY: false,
		env: {},
	});
	expect([piped.exitCode, piped.stderr.join('')]).toEqual([0, '']);
	expect(prompts).toEqual(['Prepare this release and open its version PR?']);
	expect(piped.stdout.join('')).toContain('Release preparation cancelled.');
	expect(prepareCalls()).toHaveLength(0);
});

test('without terminal input a cli start releases and approves its publication without asking', async () => {
	const repository = await cliStarts();
	releaseRun(repository);
	const started = await app.execute(['release', 'patch', '--repository', repository.name], { isTTY: false, env: {} });
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(started.stdout.join('')).toContain('Released 1.0.1 of octo/widget');
	expect(prepareCalls()).toHaveLength(1);
	const promoted = (await promotions()).filter(execution => execution.version === '1.0.1');
	expect(promoted.map(execution => [execution.state, execution.approvedBy])).toEqual([['succeeded', 'start']]);
});

test('release output carries color and links in a terminal and the same text without them', async () => {
	const repository = await cliStarts();
	const capture = (color: boolean) => {
		const lines: string[] = [];
		const out = createOutput({
			isTTY: true,
			color,
			hyperlinks: true,
			stdout: line => lines.push(line),
			stderr: () => undefined,
		});
		return { out, lines };
	};
	const normalized = (lines: string[]) => lines.join('').replace(/(?<![0-9a-f])[0-9a-f]{12,64}(?![0-9a-f])/g, '<id>');
	const colored = capture(true);
	releaseRun(repository);
	await Effect.runPromise(
		releaseRepository(
			client,
			{ repository: repository.name, version: 'patch', yes: true, dryRun: false },
			() => Promise.reject(new Error('No prompt expected')),
			colored.out,
		),
	);
	colored.out.stopActive();
	const text = normalized(colored.lines);
	expect(text).toContain('\u001b[');
	expect(text).toContain('\u001b]8;;https://github.com/octo/widget/actions/runs/');
	expect(text).toMatchSnapshot('colored');
	expect(strip(text)).toMatchSnapshot('plain');
	expect(strip(text)).toContain('Release octo/widget / main → 1.0.1');
});

test('release shows the wait for checks and stops with the failing check', async () => {
	const repository = await cliStarts();
	const steps = [
		() => world.wait(16_000),
		async () => {
			repository.checks.set(world.github.head(repository), [
				{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 },
			]);
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			repository.checks.set(world.github.head(repository), [
				{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 },
			]);
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(1);
	const head = world.github.head(repository);
	expect(result.activity).toContainEqual({
		type: 'spinner:update',
		text: `Waiting for checks on ${
			head.slice(0, 12)
		}: Releases when the commit is verified and its checks pass: test is still running`,
	});
	expect(result.activity).toContainEqual({ type: 'spinner:fail', text: 'The release stopped: test failure' });
	expect(repository.runs).toEqual([]);
});

test('release links the version PR of a started release and stops following for the merge', async () => {
	const repository = await cliStarts();
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.prepare = { strategy: 'managed', bump: 'pr' };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Bump through a PR');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(0);
	expect(result.activity).toContainEqual({
		type: 'spinner:succeed',
		text: `Version PR https://github.com/octo/widget/pull/${repository.pulls[0]?.number}`,
	});
	expect(result.stdout.join('')).toContain('Merging the version PR continues the release without another approval.');
});

test('release stops with the reason when the version bump fails', async () => {
	const repository = await cliStarts();
	repository.protectedBranches.add(repository.defaultBranch);
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(1);
	expect(result.activity).toContainEqual(expect.objectContaining({
		type: 'spinner:fail',
		text: expect.stringContaining('The version bump stopped: GitHub refused the version commit on main'),
	}));
});

test('release reports a failed release run with its link', async () => {
	const repository = await cliStarts();
	const steps = [
		() => world.wait(16_000),
		async () => {
			passChecks(repository, world.github.head(repository));
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			const dispatched = repository.runs.at(-1);
			if (!dispatched) throw new Error('The release dispatched no run');
			dispatched.status = 'in_progress';
			await begin(
				world,
				runIdentity(repository, dispatched, 'publish.yml'),
				dispatched.inputs.beepboop_execution_id ?? '',
				'main',
				'promote',
			);
		},
		async () => {
			const dispatched = repository.runs.at(-1);
			if (!dispatched) throw new Error('The release dispatched no run');
			dispatched.status = 'completed';
			dispatched.conclusion = 'failure';
			await world.workflowRun(repository, dispatched, 'failure', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(1);
	expect(result.activity).toContainEqual(expect.objectContaining({ type: 'progress:start', label: 'Publishing' }));
	expect(result.activity).toContainEqual(expect.objectContaining({ type: 'progress:fail' }));
	expect(result.stdout.join('')).toContain(
		`Run: https://github.com/octo/widget/actions/runs/${repository.runs.at(-1)?.id}`,
	);
});

async function binaryStarts() {
	const repository = await cliStarts();
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.promote.workflow.publications = ['pkg:npm/widget', 'github-release:octo/widget'];
	configuration.streams.main.promote.workflow.setup = {
		binaries: {
			builds: [{ toolchain: 'cargo', name: 'widget', manifest: 'Cargo.toml' }],
			targets: ['linux-amd64', 'darwin-arm64'],
		},
	};
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Build release binaries',
	);
	passChecks(repository, head.sha);
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	return repository;
}

test('release follows each binary build leg and asset upload of a started release', async () => {
	const repository = await binaryStarts();
	const legs = ['Build widget (x86_64-unknown-linux-gnu)', 'Build widget (aarch64-apple-darwin)'];
	const assets = ['widget-x86_64-unknown-linux-gnu', 'widget-aarch64-apple-darwin'];
	const dispatched = () => {
		const run = repository.runs.at(-1);
		if (!run) throw new Error('The release dispatched no run');
		return run;
	};
	const steps = [
		() => world.wait(16_000),
		async () => {
			passChecks(repository, world.github.head(repository));
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			const run = dispatched();
			run.status = 'in_progress';
			run.jobs = [
				{ name: legs[0] ?? '', status: 'completed', conclusion: 'success' },
				{ name: legs[1] ?? '', status: 'in_progress', conclusion: null },
			];
			await begin(
				world,
				runIdentity(repository, run, 'publish.yml'),
				run.inputs.beepboop_execution_id ?? '',
				'main',
				'promote',
			);
		},
		async () => {
			const run = dispatched();
			run.jobs = legs.map(name => ({ name, status: 'completed', conclusion: 'success' }));
		},
		async () => {
			const run = dispatched();
			const identity = runIdentity(repository, run, 'publish.yml');
			world.npm.publish('widget', '1.0.1');
			await runAction(world, 'report', identity, {
				EXECUTION_ID: run.inputs.beepboop_execution_id ?? '',
				PUBLICATIONS: JSON.stringify([
					{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
				]),
			});
			const draft = repository.releases.find(release => release.draft);
			if (!draft) throw new Error('The release has no draft');
			draft.assets = [assets[0] ?? ''];
		},
		async () => {
			const run = dispatched();
			const draft = repository.releases.find(release => release.draft);
			if (!draft) throw new Error('The release has no draft');
			draft.assets = [...assets];
			world.github.recordTag(repository, 'v1.0.1', 'a'.repeat(40), world.github.head(repository), true);
			await runAction(world, 'release', runIdentity(repository, run, 'publish.yml'), {
				EXECUTION_ID: run.inputs.beepboop_execution_id ?? '',
			});
			run.status = 'completed';
			run.conclusion = 'success';
			await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.stderr).toEqual([]);
	const progress = result.activity.flatMap(event =>
		event.type === 'progress:start'
			? [`start ${event.label} ${event.total}`]
			: event.type === 'progress:update'
			? [`update ${event.value}`]
			: event.type === 'progress:done'
			? [`done ${event.text ?? ''}`]
			: []
	);
	expect(progress).toEqual([
		'start Building binaries 2',
		'update 1',
		'update 2',
		'done Built 2 binaries',
		'start Publishing 1',
		'update 0',
		'update 1',
		'done Published 1 of 1',
		'start Uploading assets 2',
		'update 1',
		'update 2',
		'done Uploaded 2 of 2 assets',
	]);
	const output = result.stdout.join('');
	expect(output).toContain(
		'binary  target        build        asset                            upload    \n'
			+ '------  ------------  -----------  -------------------------------  ----------\n'
			+ 'widget  linux-amd64   ✔ succeeded  widget-x86_64-unknown-linux-gnu  ✔ uploaded\n'
			+ 'widget  darwin-arm64  ✔ succeeded  widget-aarch64-apple-darwin      ✔ uploaded\n',
	);
	expect(output).toContain('GitHub release: https://github.com/octo/widget/releases/tag/v1.0.1\n');
	expect(result.exitCode).toBe(0);
});

test('a failed build leg shows in the binary progress and the binaries table', async () => {
	const repository = await binaryStarts();
	const steps = [
		() => world.wait(16_000),
		async () => {
			passChecks(repository, world.github.head(repository));
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			const run = repository.runs.at(-1);
			if (!run) throw new Error('The release dispatched no run');
			run.status = 'in_progress';
			run.jobs = [
				{ name: 'Build widget (x86_64-unknown-linux-gnu)', status: 'queued', conclusion: null },
				{ name: 'Build widget (aarch64-apple-darwin)', status: 'in_progress', conclusion: null },
			];
			await begin(
				world,
				runIdentity(repository, run, 'publish.yml'),
				run.inputs.beepboop_execution_id ?? '',
				'main',
				'promote',
			);
		},
		async () => {
			const run = repository.runs.at(-1);
			if (!run) throw new Error('The release dispatched no run');
			run.jobs = [
				{ name: 'Build widget (x86_64-unknown-linux-gnu)', status: 'completed', conclusion: 'cancelled' },
				{ name: 'Build widget (aarch64-apple-darwin)', status: 'completed', conclusion: 'failure' },
			];
			run.status = 'completed';
			run.conclusion = 'failure';
			await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(1);
	expect(result.activity).toContainEqual(
		expect.objectContaining({ type: 'progress:start', label: 'Building binaries' }),
	);
	expect(result.activity).toContainEqual(expect.objectContaining({ type: 'progress:fail' }));
	const output = result.stdout.join('');
	expect(output).toContain('widget  linux-amd64   ○ skipped');
	expect(output).toContain('widget  darwin-arm64  ✖ failed');
});
