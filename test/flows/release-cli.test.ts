import { beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PromptEngine } from '@kjanat/dreamcli';
import { begin, gitOutput, runAction, runIdentity } from '@root/test/support/actions.ts';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { loggedErrors } from '@root/test/support/process.ts';
import { releasesOf } from '@root/test/support/releases.ts';
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
import { Effect, Schema, Struct } from 'effect';
import type { Client } from '@/cli/client/api';
import { saveSession } from '@/cli/client/session-store';
import { checkoutRepository } from '@/cli/git-checkout';
import { app } from '@/cli/main';
import { routes } from '@/contract/routes';
import { binaryProgress, planReview } from '@/contract/views';
import { publishWhenNames, startFromEffect } from '@/domain/setup-terms.ts';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/kernel/schema/structs.ts';
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
} from '@/kernel/schema/structs.ts';
import { runFailedNote } from '@/release/domain/execution/execution.ts';

let world: World, directory: string, client: Client, token: string;
const requests: { path: string; body: unknown }[] = [];
const plans: Decoded<typeof planReview>[] = [];
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
		if (path === '/api/releases/plan' && response.ok) plans.push(decodeSync(planReview, await response.clone().json()));
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
const streamRecord = mutableRecord(Schema.String, Schema.Unknown);
function widgetStreams() {
	return decodeSync(looseStruct({ streams: streamRecord }), JSON.parse(widgetConfiguration()));
}
function withMain(configuration: ReturnType<typeof widgetStreams>, changes: Record<string, unknown>) {
	return { ...decodeSync(streamRecord, configuration.streams.main), ...changes };
}

async function delegated(packages = ['widget'], published: Record<string, string> = { widget: '1.2.3' }) {
	const repository = widget(world.github);
	const configuration = editableConfiguration();
	configuration.streams.main.prepare = { strategy: 'workflow', workflow: { file: 'prepare.yml' } };
	configuration.streams.main.packages = packages.map(name => `pkg:npm/${name}`);
	configuration.streams.main.mustPublish = configuration.streams.main.packages;
	configuration.streams.main.release.workflow.publications = configuration.streams.main.packages;
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
		spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
		const accepted = await run(['release', 'patch'], [true]);
		expect(accepted.exitCode).toBe(0);
		expect(accepted.stdout.join('')).toContain('Merging the version PR publishes the release, and nothing asks again.');
		expect(accepted.stdout.join('')).not.toContain('runs publish');
		expect(prepareCalls()).toHaveLength(1);
		expect(prepareCalls()[0]?.body).toEqual({
			repositoryId: repository.id,
			stream: 'main',
			version: { bump: 'patch' },
			sourceSha: plans.at(-1)?.sourceSha,
			planId: plans.at(-1)?.planId,
			start: true,
		});
		expect(repository.pulls).toHaveLength(1);
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
		release: {
			publishWhen: 'approved-in-beepboop',
			workflow: { file: 'second.yml', publications: ['pkg:npm/widget'] },
		},
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
		color: false,
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
		color: false,
		env: {},
	});
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.join('')).toContain('Refresh discovery');
	expect(requests.filter(request => request.path === '/api/releases/plan')).toHaveLength(1);
	expect(prepareCalls()).toHaveLength(1);
	expect(await Effect.runPromise(client.call(routes.executionsList, {}))).toEqual([]);
	expect(repository.pulls).toHaveLength(0);
});

test('a version the manifests already carry gets its release, and independent streams refuse a release', async () => {
	const repository = await seed();
	const carried = world.github.push(repository, {
		'package.json': npmManifest('widget', '1.1.0'),
	}, 'Versions already prepared');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const prepared = await run(['release', '1.1.0', '--repository', repository.name, '--yes', '--json']);
	expect(prepared.exitCode).toBe(0);
	expect(prepareCalls()).toHaveLength(1);
	expect(releasesOf(await Effect.runPromise(client.call(routes.executionsList, {})))).toEqual([
		expect.objectContaining({ version: '1.1.0', sourceSha: carried.sha, approvedBy: 'start' }),
	]);
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, { versionScope: 'per-package' });
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
	expect(prepareCalls()).toHaveLength(1);
});

for (const [bump, version] of [['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']] as const) {
	test(`workflow-delegated ${bump} resolves on the server and prepares its reviewed target`, async () => {
		const { repository } = await delegated();
		const source = world.github.head(repository);
		const preview = await run(['release', bump, '--repository', repository.name, '--json']);
		expect(preview.exitCode).toBe(0);
		const plan = decodeSync(planReview, JSON.parse(preview.stdout.join('')).plan);
		expect(plan.version).toBe(version);
		expect(plan.edits).toEqual([]);
		expect(plan.requiresPreparation).toBe(true);
		expect(plan.starts).toBe(false);
		expect(prepareCalls()).toHaveLength(0);
		const prepared = await run(['release', bump, '--repository', repository.name, '--json', '--yes']);
		expect(prepared.exitCode).toBe(0);
		const output = JSON.parse(prepared.stdout.join(''));
		expect(output).toMatchObject({ plan: { version }, preparation: { operation: 'prepare', version } });
		expect(output.preparation).not.toHaveProperty('started');
		expect(prepareCalls()[0]?.body).toEqual({
			repositoryId: repository.id,
			stream: 'main',
			version: { bump },
			sourceSha: plan.sourceSha,
			planId: plan.planId,
			start: false,
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

test('delegated manifest preparation can release when its prepared versions reach the default branch', async () => {
	const { repository } = await delegated();
	const prepared = await run(['release', 'patch', '--repository', repository.name, '--json', '--yes']);
	expect(prepared.exitCode).toBe(0);
	await world.wait(20_000);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).toEqual(['prepare.yml']);
	// The repository workflow supplies these generated changes; the CLI does not run it locally.
	const merged = world.github.push(repository, {
		'package.json': npmManifest('widget', '1.2.4'),
	}, 'Merge the workflow-prepared package version');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([
		expect.objectContaining({ version: '1.2.4', sourceSha: merged.sha, state: 'awaiting-approval' }),
	]);
});

async function tagged(approval: 'required' | 'push' = 'required') {
	const { repository, configuration } = await delegated();
	configuration.streams.main.release.workflow.refs = { phase: 'version', prefix: 'v' };
	configuration.streams.main.release.publishWhen = publishWhenNames[approval];
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Tag each release');
	const before = world.github.head(repository);
	const merged = world.github.push(repository, {
		'package.json': npmManifest('widget', '1.2.4'),
	}, 'Merge the workflow-prepared package version');
	return { repository, before, merged };
}
const releaseExecutions = async () => releasesOf(await Effect.runPromise(client.call(routes.executionsList, {})));

async function awaitingReleaseExecution() {
	const { repository, merged } = await tagged();
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const [releaseExecution] = await releaseExecutions();
	if (!releaseExecution || releaseExecution.state !== 'awaiting-approval') {
		throw new Error('No awaiting releaseExecution');
	}
	return { repository, merged, releaseExecution };
}

test.each([7, 12, 40])('publish accepts a %i-character reviewed commit and audits its full SHA', async length => {
	const { merged, releaseExecution } = await awaitingReleaseExecution();
	const result = await run([
		'runs',
		'publish',
		releaseExecution.id.slice(0, 12),
		'--sourceSha',
		merged.sha.slice(0, length),
		'--json',
	]);
	expect([result.exitCode, result.stderr.join('')]).toEqual([0, '']);
	expect(JSON.parse(result.stdout.join(''))).toMatchObject({
		id: releaseExecution.id,
		sourceSha: merged.sha,
		state: 'ready',
	});
	const audit = await world.db.prepare("SELECT target FROM audit WHERE action='release.approve'").first();
	expect(audit).toMatchObject({ target: `${releaseExecution.id}:${merged.sha}` });
});

test('approval API rejects malformed commit references and audits a valid short reference as its full SHA', async () => {
	const { merged, releaseExecution } = await awaitingReleaseExecution();
	const api = bearer(world, token);
	const before = await releaseExecutions();
	for (const sourceSha of [merged.sha.slice(0, 6), merged.sha + 'a', 'ABCDEF0', 'ggggggg']) {
		const response = await api('/api/executions/approve', { id: releaseExecution.id, sourceSha, force: true });
		expect(response.status).toBe(400);
		expect(await releaseExecutions()).toEqual(before);
		expect(await world.db.prepare("SELECT target FROM audit WHERE action='release.approve'").first()).toBeNull();
	}
	const response = await api('/api/executions/approve', { id: releaseExecution.id, sourceSha: merged.sha.slice(0, 7) });
	expect(response.status).toBe(200);
	expect(response.body).toMatchObject({ id: releaseExecution.id, sourceSha: merged.sha, state: 'ready' });
	expect(await world.db.prepare("SELECT target FROM audit WHERE action='release.approve'").first()).toEqual({
		target: `${releaseExecution.id}:${merged.sha}`,
	});
});

test.each([7, 12])('approve accepts table values with a %i-character prompted commit', async length => {
	const { repository, merged, releaseExecution } = await awaitingReleaseExecution();
	const listed = await run(['runs', 'list', '--repository', repository.name, '--operation', 'release']);
	const row = listed.stdout.join('').split('\n').find(line =>
		line.includes(repository.name) && line.includes('release')
	);
	const [id, , , , , commit] = row?.trim().split(/\s+/) ?? [];
	if (!id || !commit) throw new Error('Missing run table row');
	expect([id, commit]).toEqual([releaseExecution.id.slice(0, 12), merged.sha.slice(0, 12)]);
	const approved = await run(['runs', 'approve', id], [commit.slice(0, length)]);
	expect([approved.exitCode, approved.stderr.join('')]).toEqual([0, '']);
	expect(await releaseExecutions()).toEqual([
		expect.objectContaining({ id: releaseExecution.id, state: 'ready', sourceSha: merged.sha }),
	]);
});

test.each([
	{ key: 'q', action: 'detach', status: 0, state: 'awaiting-approval' },
	{ key: '\x03', action: 'cancel', status: 130, state: 'cancelled' },
	{ key: 'f', action: 'force', status: 0, state: 'ready' },
])('approval can $action from its terminal', async ({ key, action, status, state }) => {
	const { repository, merged, releaseExecution } = await awaitingReleaseExecution();
	repository.checks.set(merged.sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 }]);
	using server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => world.handle(request) });
	await Effect.runPromise(
		saveSession({ directory: join(directory, 'beepboop'), origin: server.url.origin }, { token }),
	);

	let output = '';
	let inputSent = false;
	const decoder = new TextDecoder();
	await using terminal = new Bun.Terminal({
		data(tty, bytes) {
			output += decoder.decode(bytes, { stream: true });
			if (!inputSent && output.includes('q detach · Ctrl+C cancel release · f force publish')) {
				inputSent = true;
				tty.write(key);
			}
		},
	});
	const cli = Bun.spawn([
		process.execPath,
		'packages/cli/src/main.ts',
		'runs',
		'approve',
		releaseExecution.id.slice(0, 12),
		'--sourceSha',
		merged.sha.slice(0, 12),
		'--server',
		server.url.origin,
	], { terminal, env: { XDG_STATE_HOME: directory }, timeout: 8_000 });
	expect([await cli.exited, inputSent, strip(output)]).toEqual([
		status,
		true,
		expect.stringContaining('Approval queued'),
	]);
	const ref = { id: releaseExecution.id };
	const saved = await Effect.runPromise(client.call(routes.executionsGet, ref));
	expect(saved.state).toBe(state);
	if (action === 'detach') expect(saved.approvalRequest?.sourceSha).toBe(merged.sha);
	else expect(saved.approvalRequest).toBeUndefined();
	expect(world.github.dispatches).toHaveLength(0);

	if (action !== 'force') passChecks(repository, merged.sha);
	await world.wait(65_000);
	expect(world.github.dispatches).toHaveLength(action === 'cancel' ? 0 : 1);
	const audit = await world.db.prepare("SELECT target FROM audit WHERE action = 'release.approve'").all();
	expect(audit.results).toEqual(
		action === 'cancel'
			? []
			: [
				{
					target: action === 'force'
						? `${releaseExecution.id}:${merged.sha} overriding: test running`
						: `${releaseExecution.id}:${merged.sha}`,
				},
			],
	);
}, 12_000);

test('force acknowledges publication that started while the CLI waited', async () => {
	const { repository, merged, releaseExecution } = await awaitingReleaseExecution();
	const ref = { id: releaseExecution.id, sourceSha: merged.sha };
	repository.checks.set(merged.sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 }]);
	const queued = await Effect.runPromise(client.call(routes.executionsApprove, { ...ref, queue: true }));
	expect(queued.approvalRequest?.sourceSha).toBe(merged.sha);
	passChecks(repository, merged.sha);
	await world.wait(65_000);
	const started = await Effect.runPromise(client.call(routes.executionsGet, { id: releaseExecution.id }));
	expect(started.state).toBe('running');
	expect(await Effect.runPromise(client.call(routes.executionsApprove, { ...ref, force: true }))).toEqual(started);
	expect(world.github.dispatches).toHaveLength(1);
});

test.each(['failed check', 'new version'] as const)('queued approval stops on %s', async blocker => {
	const { repository, merged, releaseExecution } = await awaitingReleaseExecution();
	repository.checks.set(merged.sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 }]);
	const cli = await run(['runs', 'approve', releaseExecution.id, '--sourceSha', merged.sha, '--detach', '--json']);
	expect([cli.exitCode, cli.stderr.join('')]).toEqual([0, '']);
	expect(JSON.parse(cli.stdout.join(''))).toMatchObject({
		state: 'awaiting-approval',
		approvalRequest: { sourceSha: merged.sha },
	});
	if (blocker === 'failed check') {
		repository.checks.set(merged.sha, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 }]);
	} else {
		world.github.push(repository, { 'package.json': npmManifest('widget', '1.2.5') }, 'Raise the version again');
		passChecks(repository, merged.sha);
	}
	await world.wait(65_000);
	const saved = await Effect.runPromise(client.call(routes.executionsGet, { id: releaseExecution.id }));
	expect(saved.approvalRequest).toBeUndefined();
	expect(saved.reason).toContain(blocker === 'failed check' ? 'test' : 'Publish the release for that commit');
	passChecks(repository, merged.sha);
	await world.wait(65_000);
	expect(world.github.dispatches).toHaveLength(0);
});

test('approval refuses wrong or malformed commit references without changing the operation', async () => {
	const { merged, releaseExecution } = await awaitingReleaseExecution();
	const other = merged.sha[0] === 'a' ? 'b' : 'a';
	const suffix = merged.sha.endsWith('a') ? 'b' : 'a';
	for (const reference of [
		other + merged.sha.slice(1, 12),
		merged.sha.slice(0, 39) + suffix,
		merged.sha.slice(0, 6),
		merged.sha + 'a',
		'g'.repeat(7),
	]) {
		const refused = await run([
			'runs',
			'approve',
			releaseExecution.id.slice(0, 12),
			'--sourceSha',
			reference,
			'--force',
		]);
		expect(refused.exitCode).not.toBe(0);
	}
	expect((await releaseExecutions())[0]?.state).toBe('awaiting-approval');
	expect(world.github.dispatches).toHaveLength(0);
	expect(await world.db.prepare("SELECT target FROM audit WHERE action='release.approve'").first()).toBeNull();
});

test('approval with a short commit still rejects a branch whose version changed since', async () => {
	const { repository, merged, releaseExecution } = await awaitingReleaseExecution();
	world.github.push(repository, { 'package.json': npmManifest('widget', '1.2.5') }, 'Raise the version again');
	const refused = await run([
		'runs',
		'approve',
		releaseExecution.id.slice(0, 12),
		'--sourceSha',
		merged.sha.slice(0, 7),
	]);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain('Publish the release for that commit');
	expect((await releaseExecutions())[0]?.state).toBe('awaiting-approval');
	expect(world.github.dispatches).toHaveLength(0);
});

test('a matching commit cannot disambiguate a shared run ID prefix', async () => {
	const { merged, releaseExecution } = await awaitingReleaseExecution();
	const prefix = releaseExecution.id.slice(0, 12);
	const next = releaseExecution.id[12] === 'a' ? 'b' : 'a';
	const twin = prefix + next + releaseExecution.id.slice(13);
	await world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) SELECT ?,repository_id,state,document,updated_at FROM executions WHERE id=?',
	)
		.bind(twin, releaseExecution.id).run();
	const refused = await run(['runs', 'approve', prefix, '--sourceSha', merged.sha.slice(0, 7)]);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain(`Several operations start with ${prefix}`);
	expect(world.github.dispatches).toHaveLength(0);
});

test('a version whose tag targets another commit gets no release and a repository warning', async () => {
	const { repository, before, merged } = await tagged();
	repository.refs.set('tags/v1.2.4', before);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([]);
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
	expect(await releaseExecutions()).toEqual([]);
});

test('a package the registry cannot answer for gets no release and a repository warning', async () => {
	const { repository, merged } = await tagged();
	passChecks(repository, merged.sha);
	world.network.serve('registry.npmjs.org', () => new Response(null, { status: 503 }));
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([]);
	const discovered = await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect(discovered.findings).toContainEqual({
		code: 'release-unchecked',
		severity: 'warning',
		subject: { kind: 'stream', name: 'main' },
		message:
			'Beepboop starts no release of stream main until its registries answer for pkg:npm/widget. The next push or discovery asks again.',
	});
	world.network.serve('registry.npmjs.org', request => world.npm.handle(request));
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	await world.wait(1_000);
	expect((await releaseExecutions()).map(releaseExecution => [releaseExecution.version, releaseExecution.sourceSha]))
		.toEqual([[
			'1.2.4',
			merged.sha,
		]]);
});

async function uncheckedBesideGadget() {
	const { repository, configuration } = await delegated(['widget', 'gadget'], { widget: '1.2.3', gadget: '1.0.0' });
	const file = decodeSync(looseStruct({ streams: streamRecord }), JSON.parse(JSON.stringify(configuration)));
	const widgetId = 'pkg:npm/widget';
	const gadgetId = 'pkg:npm/gadget';
	file.streams.main = withMain(file, {
		packages: [widgetId],
		mustPublish: [widgetId],
		release: {
			...configuration.streams.main.release,
			workflow: { ...configuration.streams.main.release.workflow, publications: [widgetId] },
		},
	});
	file.streams.gadget = withMain(file, {
		packages: [gadgetId],
		mustPublish: [gadgetId],
		release: {
			publishWhen: 'approved-in-beepboop',
			workflow: { file: 'gadget.yml', publications: [gadgetId], refs: { phase: 'version', prefix: 'gadget-v' } },
		},
	});
	const head = world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(file),
		'.github/workflows/gadget.yml': publishWorkflow.replace('stream: main', 'stream: gadget'),
		'packages/gadget/package.json': JSON.stringify({ name: 'gadget', version: '1.1.0' }),
	}, 'Split gadget into its own stream');
	passChecks(repository, head.sha);
	world.network.serve('registry.npmjs.org', request =>
		new URL(request.url).pathname === '/widget'
			? new Response(null, { status: 503 })
			: world.npm.handle(request));
	return repository;
}
const tagLookup = async (request: Request) =>
	new URL(request.url).pathname === '/graphql' && (await request.clone().text()).includes('refs/tags/');

test('a registry warning survives a later stream that fails', async () => {
	const repository = await uncheckedBesideGadget();
	let tagLookups = 0;
	world.network.serve('api.github.com', async request => {
		if (await tagLookup(request)) {
			tagLookups++;
			return Response.json({ message: 'Unicorn' }, { status: 502 });
		}
		return world.github.handle(request);
	});
	const discovered = await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect(tagLookups).toBeGreaterThan(0);
	expect(discovered.findings).toContainEqual({
		code: 'release-unchecked',
		severity: 'warning',
		subject: { kind: 'stream', name: 'main' },
		message:
			'Beepboop starts no release of stream main until its registries answer for pkg:npm/widget. The next push or discovery asks again.',
	});
});

test('the warnings of a slow discovery never replace a newer discovery', async () => {
	const repository = await uncheckedBesideGadget();
	let release!: () => void, entered!: () => void;
	const held = new Promise<void>(resolve => {
		release = resolve;
	});
	const reached = new Promise<void>(resolve => {
		entered = resolve;
	});
	let first = true;
	world.network.serve('api.github.com', async request => {
		if (await tagLookup(request)) {
			if (first) {
				first = false;
				entered();
				await held;
			}
			return Response.json({ message: 'Unicorn' }, { status: 502 });
		}
		return world.github.handle(request);
	});
	const slow = Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	await reached;
	const newer = world.github.push(repository, { 'README.md': '# widget, newer\n' }, 'Move the default branch');
	passChecks(repository, newer.sha);
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	release();
	await slow;
	const row = await world.db.prepare('SELECT document FROM repositories WHERE name=?').bind(repository.name).first();
	expect(decodeSync(looseStruct({ document: Schema.String }), row).document).toContain(`"sha":"${newer.sha}"`);
});

test('releasing the version a delegated stream already carries creates its release without preparing it', async () => {
	const { repository, merged } = await tagged();
	passChecks(repository, merged.sha);
	world.network.serve('registry.npmjs.org', () => new Response(null, { status: 503 }));
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([]);
	const preview = await run(['release', '1.2.4', '--repository', repository.name, '--json']);
	expect(preview.exitCode).toBe(0);
	const plan = decodeSync(planReview, JSON.parse(preview.stdout.join('')).plan);
	expect([plan.sourceSha, plan.edits, plan.requiresPreparation]).toEqual([merged.sha, [], false]);
	const previewed = await run(['release', '1.2.4', '--repository', repository.name, '--dry-run']);
	expect([previewed.exitCode, previewed.stderr.join('')]).toEqual([0, '']);
	const output = previewed.stdout.join('');
	expect(output).toContain('main already carries 1.2.4. Starting publishes it.');
	expect(output).not.toContain('determined by preparation workflow');
	const released = await run(['release', '1.2.4', '--repository', repository.name, '--json', '--yes']);
	expect([released.exitCode, released.stderr.join('')]).toEqual([0, '']);
	expect(JSON.parse(released.stdout.join(''))).toHaveProperty('preparation.operation', 'release');
	expect(await releaseExecutions()).toEqual([
		expect.objectContaining({ version: '1.2.4', sourceSha: merged.sha, approvedBy: 'start' }),
	]);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).not.toContain('prepare.yml');
});

test('releasing a carried version refuses a version tag on another commit', async () => {
	const { repository, before, merged } = await tagged();
	repository.refs.set('tags/v1.2.4', before);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([]);
	const refused = await run(['release', '1.2.4', '--repository', repository.name, '--yes']);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain(
		`Version tag v1.2.4 already targets ${before.slice(0, 12)}. Release a new version.`,
	);
	expect(await releaseExecutions()).toEqual([]);
});

test('a delegated stream refuses a version its registries already publish or have passed', async () => {
	const { repository } = await tagged();
	world.npm.publish('widget', '1.2.4');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const released = await run(['release', '1.2.4', '--repository', repository.name, '--yes']);
	expect(released.exitCode).not.toBe(0);
	expect(released.stderr.join('')).toContain('1.2.4 is already released');
	const older = await run(['release', '1.2.2', '--repository', repository.name, '--yes']);
	expect(older.exitCode).not.toBe(0);
	expect(older.stderr.join('')).toContain('Target version must be newer');
	expect(prepareCalls()).toHaveLength(0);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).not.toContain('prepare.yml');
});

test('no approval overrides a version tag on another commit, and the CLI cancels the release', async () => {
	const { repository, before, merged } = await tagged();
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const [releaseExecution] = await releaseExecutions();
	if (!releaseExecution) throw new Error('No releaseExecution');
	expect(releaseExecution).toEqual(expect.objectContaining({ state: 'awaiting-approval', sourceSha: merged.sha }));
	repository.refs.set('tags/v1.2.4', before);
	const conflict = `Version tag v1.2.4 already targets ${before.slice(0, 12)}`;
	expect(await Effect.runPromise(client.call(routes.executionsApproval, { id: releaseExecution.id }))).toEqual({
		problems: [],
		blocked: [`${conflict}. Release a new version.`],
	});
	for (const command of ['publish', 'approve']) {
		const forced = await run(['runs', command, releaseExecution.id, '--sourceSha', merged.sha, '--force']);
		expect([command, forced.exitCode === 0, forced.stderr.join('')]).toEqual([
			command,
			false,
			expect.stringContaining(conflict),
		]);
	}
	expect((await releaseExecutions())[0]?.state).toBe('awaiting-approval');
	const cancelled = await run(['runs', 'cancel', releaseExecution.id, '--json']);
	expect(cancelled.exitCode).toBe(0);
	expect(await releaseExecutions()).toEqual([expect.objectContaining({ id: releaseExecution.id, state: 'cancelled' })]);
	expect((await run(['runs', 'cancel', releaseExecution.id])).exitCode).not.toBe(0);
});

test('push approval cancels a release once its version tag targets another commit', async () => {
	const { repository, before, merged } = await tagged('push');
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const [releaseExecution] = await releaseExecutions();
	expect(releaseExecution).toEqual(expect.objectContaining({ state: 'awaiting-approval', sourceSha: merged.sha }));
	repository.refs.set('tags/v1.2.4', before);
	passChecks(repository, merged.sha);
	await world.wait(60_000);
	expect(await releaseExecutions()).toEqual([expect.objectContaining({
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
		'Granting octo/widget main/release access to npm-token.\n✔ octo/widget main/release can use npm-token.\n',
	);
	expect(granted.activity).toContainEqual({ type: 'spinner:start', text: 'Reading octo/widget' });
	const listed = await run(['secrets', 'list']);
	expect(listed.activity).toContainEqual({ type: 'spinner:start', text: 'Naming the granted repositories' });
	expect(listed.stdout.join('')).toMatch(/npm-token\s+octo\/widget\s+release\s+runtime/);
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

test('managed manifest plans with custom version files release after the preparation PR is merged', async () => {
	const repository = await seed();
	const configuration = decodeSync(
		looseStruct({ streams: looseStruct({ main: looseStruct({}) }) }),
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.main.versionFiles = [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }];
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'VERSION': 'version=1.0.0\n',
	}, 'Keep the custom version file synchronized');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
	const prepared = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('Merging the version PR publishes the release, and nothing asks again.');
	expect(prepared.stdout.join('')).not.toContain('runs publish');
	expect(plans.at(-1)?.edits.map(edit => edit.path).sort()).toEqual(['VERSION', 'package.json']);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	expect(world.github.file(repository, 'VERSION', pull.head.sha)).toBe('version=1.0.1\n');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect(await releaseExecutions()).toEqual([
		expect.objectContaining({ version: '1.0.1', sourceSha: merged.sha, approvedBy: 'start' }),
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
					mustPublish: [packageId],
					versionFiles: [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }],
					prepare: { strategy: 'managed' },
					release: {
						publishWhen: 'approved-in-beepboop',
						workflow: { file: 'publish.yml', publications: [packageId] },
					},
				},
			},
		}),
	});
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
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
	expect(await releaseExecutions()).toEqual([]);
});

test('workflow bumps require a known baseline and explicit versions stay delegated', async () => {
	const { repository } = await delegated(['widget'], {});
	const refused = await run(['release', 'patch', '--repository', repository.name, '--yes', '--json']);
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stdout.join('')).toContain('explicit version for the first release');
	expect(prepareCalls()).toHaveLength(0);
	const explicit = await run(['release', '4.0.0', '--repository', repository.name, '--json']);
	expect(explicit.exitCode).toBe(0);
	const plan = decodeSync(planReview, JSON.parse(explicit.stdout.join('')).plan);
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
	expect(decodeSync(planReview, JSON.parse(explicit.stdout.join('')).plan).version).toBe('4.0.0');
	configuration.streams.main.packages = ['pkg:npm/widget'];
	configuration.streams.main.mustPublish = ['pkg:npm/widget'];
	configuration.streams.main.release.workflow.publications = ['pkg:npm/widget'];
	world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Select only widget for this stream',
	);
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const selected = await run(['release', 'minor', '--repository', repository.name, '--json']);
	expect(selected.exitCode).toBe(0);
	expect(decodeSync(planReview, JSON.parse(selected.stdout.join('')).plan).version).toBe('1.3.0');
});

test('a tag-derived version its registry already publishes is refused, not prepared again', async () => {
	const { repository, configuration } = await delegated(['widget'], { widget: '2.5.0' });
	configuration.streams.main.versionSource = { kind: 'tags', prefix: 'v' };
	world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Take release versions from tags',
	);
	repository.refs.set('tags/v2.4.6', world.github.head(repository));
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	for (const version of ['minor', '2.5.0']) {
		const refused = await run(['release', version, '--repository', repository.name, '--yes']);
		expect([version, refused.exitCode === 0, refused.stderr.join('')]).toEqual([
			version,
			false,
			expect.stringContaining('2.5.0 is already released'),
		]);
	}
	const behind = await run(['release', 'patch', '--repository', repository.name, '--yes']);
	expect([behind.exitCode === 0, behind.stderr.join('')]).toEqual([
		false,
		expect.stringContaining('Target version must be newer'),
	]);
	expect(prepareCalls()).toHaveLength(0);
	expect(world.github.dispatches.map(dispatch => dispatch.file)).not.toContain('prepare.yml');
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
	const plan = decodeSync(planReview, JSON.parse(preview.stdout.join('')).plan);
	expect(plan.version).toBe('2.5.0');
	expect(plan.edits).toEqual([]);
	expect(plan.requiresPreparation).toBe(true);
	const explicit = await run(['release', '3.0.0', '--repository', repository.name, '--json']);
	expect(explicit.exitCode).toBe(0);
	expect(decodeSync(planReview, JSON.parse(explicit.stdout.join('')).plan).version).toBe('3.0.0');
	expect(prepareCalls()).toHaveLength(0);
	const existing = (await releaseExecutions()).map(execution => execution.id);
	const prepared = await run(['release', 'minor', '--repository', repository.name], [true]);
	expect(prepared.exitCode).toBe(0);
	expect(prepared.stdout.join('')).toContain('tag-based streams do not start publication after merge');
	expect(prepared.stdout.join('')).toContain('Starting publication from this preparation is not supported yet');
	expect(prepared.stdout.join('')).not.toContain('releases start');
	expect(prepared.stdout.join('')).not.toContain('runs publish');
	const merged = world.github.push(repository, {
		'package.json': npmManifest('widget', '2.5.0'),
	}, 'Merge the tag-derived preparation');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect((await releaseExecutions()).map(execution => execution.id)).toEqual(existing);
});

async function cliStarts() {
	const repository = await seed();
	const configuration = decodeSync(
		looseStruct({ streams: looseStruct({ main: looseStruct({}) }) }),
		JSON.parse(widgetConfiguration()),
	);
	configuration.streams.main.prepare = { strategy: 'managed', versionLands: 'via-direct-commit' };
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
			await begin(world, identity, execution, 'main', 'release');
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
	expect(output).not.toContain('Failing checks or package metadata problems');
	expect(output).not.toContain('runs publish');
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

test('release help explains the flow, and the command list keeps the one-line description', async () => {
	const help = await app.execute(['release', '--help'], { isTTY: false, env: {} });
	const text = help.stdout.join('').replace(/\s+/g, ' ');
	expect(text).toContain('The release bumps the version and publishes it, and nothing asks again.');
	expect(text).toContain(
		'Managed version files can start a release when the release workflow publishes the version tag.',
	);
	expect(text).toContain('`versionLands: via-version-pr` opens the version PR');
	const root = (await app.execute(['--help'], { isTTY: false, env: {} })).stdout.join('').replace(/\s+/g, ' ');
	expect(root).toContain('release Release this Git checkout: preview a version on the server, confirm, then act');
	expect(root).not.toContain('startFrom');
});

test('--dry-run plans and previews without a prompt or a release', async () => {
	const repository = await cliStarts();
	const previewed = await app.execute(['release', 'patch', '--repository', repository.name, '--dry-run'], {
		isTTY: true,
		color: false,
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
	expect(decodeSync(planReview, JSON.parse(json.stdout.join('')).plan).version).toBe('1.0.1');
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
			await begin(world, identity, execution, 'main', 'release');
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
		color: false,
		env: {},
		prompter: {
			promptOne: config => {
				prompts.push(config.message);
				return Promise.resolve({ answered: true, value: true });
			},
		},
	});
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(prompts).toEqual([`Start this release? ${startFromEffect}`]);
	const output = started.stdout.join('');
	expect(output).toContain('main already carries 1.0.1. Starting publishes it.');
	expect(output).toContain('Beepboop publishes once the commit is verified and its checks pass.');
	expect(output).toContain('Released 1.0.1 of octo/widget');
	expect(output).not.toContain('runs publish');
	expect(started.activity).toContainEqual({ type: 'spinner:start', text: 'Starting the release of 1.0.1' });
	expect(prepareCalls()).toHaveLength(1);
	expect(world.github.dispatches.filter(dispatch => dispatch.file === 'publish.yml')).toHaveLength(1);
	const releasedRuns = (await releaseExecutions()).filter(execution => execution.version === '1.0.1');
	expect(releasedRuns.map(execution => [execution.state, execution.approvedBy])).toEqual([['succeeded', 'start']]);
});

test('release --force publishes over a failed check without asking', async () => {
	const repository = await cliStarts();
	const head = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	repository.checks.set(head.sha, [{ name: 'test', status: 'completed', conclusion: 'cancelled', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const steps = [
		() => world.wait(16_000),
		async () => {
			const dispatched = repository.runs.at(-1);
			const execution = dispatched?.inputs.beepboop_execution_id;
			if (!dispatched || !execution) throw new Error('The forced release dispatched no run');
			dispatched.status = 'in_progress';
			const identity = runIdentity(repository, dispatched, 'publish.yml');
			await begin(world, identity, execution, 'main', 'release');
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
	const forced = await app.execute(['release', '1.0.1', '--repository', repository.name, '--force'], {
		isTTY: true,
		color: false,
		env: {},
		prompter: { promptOne: config => Promise.reject(new Error(`Unexpected prompt: ${config.message}`)) },
	});
	expect([forced.exitCode, forced.stderr.join('')]).toEqual([0, '']);
	const output = forced.stdout.join('');
	expect(output).toContain('Beepboop publishes without waiting on checks, the commit signature or package metadata.');
	expect(output).not.toContain('Failing checks or package metadata problems');
	expect(output).toContain('Released 1.0.1 of octo/widget');
	expect(prepareCalls().map(call => call.body)).toEqual([expect.objectContaining({ force: true })]);
	const releasedRuns = (await releaseExecutions()).filter(execution => execution.version === '1.0.1');
	expect(releasedRuns).toEqual([
		expect.objectContaining({ state: 'succeeded', started: expect.objectContaining({ force: true }) }),
	]);
});

test('release --force --json starts the release without asking', async () => {
	const repository = await cliStarts();
	const head = world.github.push(repository, { 'package.json': npmManifest('widget', '1.0.1') }, 'Release 1.0.1');
	passChecks(repository, head.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const forced = await run(['release', '1.0.1', '--repository', repository.name, '--force', '--json']);
	expect(forced.exitCode).toBe(0);
	expect(JSON.parse(forced.stdout.join(''))).toHaveProperty('preparation.operation', 'release');
	expect(requests.find(call => call.path === '/api/releases/plan')?.body).toMatchObject({ force: true });
	expect(prepareCalls().map(call => call.body)).toEqual([expect.objectContaining({ force: true })]);
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
		app.execute(['release', ...args, '--repository', repository.name], { isTTY, color: false, env: {} });
	const missing = await headless([], false);
	expect(missing.exitCode).not.toBe(0);
	expect(missing.stderr.join('')).toContain('Choose a release version or bump');
	expect(missing.stderr.join('')).toContain('Pass patch, minor, major or a semantic version');
	expect(prepareCalls()).toHaveLength(0);
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
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
	expect(prompts).toEqual([`Start this release? ${startFromEffect}`]);
	expect(piped.stdout.join('')).toContain('Release start cancelled.');
	expect(prepareCalls()).toHaveLength(0);
});

test('without terminal input a cli start releases and approves its publication without asking', async () => {
	const repository = await cliStarts();
	releaseRun(repository);
	const started = await app.execute(['release', 'patch', '--repository', repository.name], { isTTY: false, env: {} });
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(started.stdout.join('')).toContain('Released 1.0.1 of octo/widget');
	expect(prepareCalls()).toHaveLength(1);
	const releasedRuns = (await releaseExecutions()).filter(execution => execution.version === '1.0.1');
	expect(releasedRuns.map(execution => [execution.state, execution.approvedBy])).toEqual([['succeeded', 'start']]);
});

test('a release of a stream that publishes on merge starts anyway and asks to start it', async () => {
	const repository = await seed();
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, {
		prepare: { strategy: 'managed', versionLands: 'via-direct-commit' },
		release: { ...decodeSync(looseStruct({}), withMain(configuration, {}).release), publishWhen: 'version-pr-merged' },
	});
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Publish on merge');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const prompts: string[] = [];
	const declined = await app.execute(['release', 'patch', '--repository', repository.name], {
		isTTY: true,
		color: false,
		env: {},
		prompter: {
			promptOne: config => {
				prompts.push(config.message);
				return Promise.resolve({ answered: true, value: false });
			},
		},
	});
	expect([declined.exitCode, declined.stderr.join('')]).toEqual([0, '']);
	expect(plans.at(-1)?.starts).toBe(true);
	expect(prompts).toEqual([`Start this release? ${startFromEffect}`]);
	expect(declined.stdout.join('')).not.toContain('This prepares 1.0.1');
	expect(declined.stdout.join('')).toContain('Release start cancelled.');
	expect(prepareCalls()).toHaveLength(0);
});

test('release output carries color and links in a terminal and the same text without them', async () => {
	const repository = await cliStarts();
	const normalized = (lines: readonly string[]) =>
		lines.join('').replace(/(?<![0-9a-f])[0-9a-f]{12,64}(?![0-9a-f])/g, '<id>');
	releaseRun(repository);
	const colored = await app.execute(['release', 'patch', '--repository', repository.name, '--yes'], {
		isTTY: true,
		color: true,
		env: {},
	});
	expect([colored.exitCode, colored.stderr.join('')]).toEqual([0, '']);
	const text = normalized(colored.stdout);
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
	const result = await run(['release', 'patch', '--repository', repository.name], [true, 'stop']);
	expect(result.exitCode).toBe(1);
	const head = world.github.head(repository);
	expect(result.activity).toContainEqual({
		type: 'spinner:update',
		text: `${head.slice(0, 12)}: test running`,
	});
	expect(result.activity.map(event => event.type)).toContain('spinner:fail');
	expect(result.stderr.join('')).toBe('checks failed: test\n');
	expect(repository.runs).toEqual([]);
});

function stoppedThenPublished(
	repository: Repository,
	rerun: boolean,
	stop: (head: string) => void = head => {
		repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 50 }]);
	},
	ci: 'completed' | 'in_progress' = 'completed',
) {
	const steps = [
		() => world.wait(16_000),
		async () => {
			const head = world.github.head(repository);
			stop(head);
			repository.runs.push({
				id: 50,
				path: '.github/workflows/ci.yml',
				event: 'push',
				headSha: head,
				headBranch: repository.defaultBranch,
				status: ci,
				conclusion: ci === 'completed' ? 'failure' : null,
				attempt: 1,
				title: 'CI',
				inputs: {},
			});
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		},
		async () => {
			const ran = repository.runs.find(entry => entry.id === 50);
			if (ran) {
				ran.status = 'completed';
				ran.conclusion = rerun ? 'success' : 'failure';
			}
			if (rerun) passChecks(repository, world.github.head(repository));
			await world.wait(60_000);
		},
		async () => {
			const run = repository.runs.at(-1);
			const execution = run?.inputs.beepboop_execution_id;
			if (!run || !execution) throw new Error('The release dispatched no run');
			run.status = 'in_progress';
			const identity = runIdentity(repository, run, 'publish.yml');
			await begin(world, identity, execution, 'main', 'release');
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
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
}

test('release asks what next when the checks stop it, and releases without the check', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, false);
	const result = await run(['release', 'patch', '--repository', repository.name], [true, 'skip']);
	expect([result.exitCode, result.stderr.join('')]).toEqual([0, 'checks failed: test\n']);
	const output = result.stdout.join('');
	expect(output).toContain('This release ignores the checks that stopped it.');
	expect(output).toContain('Released 1.0.1 of octo/widget');
});

test('release --yes reruns the failed checks once and publishes once they pass', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, true);
	const result = await run(['release', 'patch', '--repository', repository.name, '--yes']);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.join('')).toContain('Beepboop reruns the failed checks and publishes once they pass.');
	expect(repository.runs.find(entry => entry.id === 50)?.attempt).toBe(2);
});

test('release --yes stops when the rerun checks fail again', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, false);
	const result = await run(['release', 'patch', '--repository', repository.name, '--yes']);
	const [releaseExecution] = await releaseExecutions();
	expect([result.exitCode, result.stderr.join('')]).toEqual([
		1,
		`checks failed: test\nchecks failed: test\nChoose with beepboop runs checks ${releaseExecution?.id} --choice rerun, skip or always\n`,
	]);
	expect(repository.runs.find(entry => entry.id === 50)?.attempt).toBe(2);
});

test('release --yes leaves a stop without a failed check to the owner', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, false, head => {
		const commit = repository.commits.get(head);
		if (commit) commit.verified = false;
		passChecks(repository, head);
	});
	const result = await run(['release', 'patch', '--repository', repository.name, '--yes']);
	const [releaseExecution] = await releaseExecutions();
	expect([result.exitCode, result.stderr.join('')]).toEqual([
		1,
		`signature unverified\nChoose with beepboop runs checks ${releaseExecution?.id} --choice rerun, skip or always\n`,
	]);
});

test('release prints the refusal of a rerun while the failed check still runs, and the command to choose again', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, false, undefined, 'in_progress');
	const result = await run(['release', 'patch', '--repository', repository.name], [true, 'rerun']);
	const [releaseExecution] = await releaseExecutions();
	expect([result.exitCode, result.stderr.join('')]).toEqual([
		1,
		`checks failed: test\nNo finished check run failed, so none can rerun\nChoose with beepboop runs checks ${releaseExecution?.id} --choice rerun, skip or always\n`,
	]);
});

test('release without a terminal names the command that resolves the stopped checks', async () => {
	const repository = await cliStarts();
	stoppedThenPublished(repository, false);
	const result = await app.execute(['release', 'patch', '--repository', repository.name], { isTTY: false, env: {} });
	const [releaseExecution] = await releaseExecutions();
	expect([result.exitCode, result.stderr.join('')]).toEqual([
		1,
		`checks failed: test\nChoose with beepboop runs checks ${releaseExecution?.id} --choice rerun, skip or always\n`,
	]);
	const chosen = await run(['runs', 'checks', releaseExecution?.id ?? '', '--choice', 'always']);
	expect(chosen.exitCode).toBe(0);
	const short = releaseExecution?.id.slice(0, 12);
	expect(chosen.activity).toEqual([
		{ type: 'spinner:start', text: `Switching off the checks of ${short}` },
		{ type: 'spinner:succeed', text: `${short} is awaiting-approval` },
	]);
});

test('release links the version PR of a started release and stops following for the merge', async () => {
	const repository = await cliStarts();
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.prepare = { strategy: 'managed', versionLands: 'via-version-pr' };
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Bump through a PR');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(0);
	expect(result.activity).toContainEqual({
		type: 'spinner:succeed',
		text: `Version PR https://github.com/octo/widget/pull/${repository.pulls[0]?.number}`,
	});
	expect(result.stdout.join('')).toContain('Merging the version PR publishes the release, and nothing asks again.');
});

test('release stops with the reason when the version bump fails', async () => {
	const repository = await cliStarts();
	repository.protectedBranches.add(repository.defaultBranch);
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(() => world.wait(16_000)));
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).toBe(1);
	expect(result.activity.map(event => event.type)).toContain('spinner:fail');
	expect(result.stderr.join('')).toContain('The version bump stopped: GitHub refused the version commit on main');
	const piped = await app.execute(['release', 'patch', '--repository', repository.name, '--yes'], {
		isTTY: false,
		env: {},
	});
	expect(piped.exitCode).toBe(1);
	expect(piped.stderr.join('')).toContain('The version bump stopped: GitHub refused the version commit on main');
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
				'release',
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
	expect(result.activity.filter(event => event.type === 'progress:fail')).toEqual([
		{ type: 'progress:fail', text: undefined },
	]);
	expect(result.stderr.join('')).toBe('GitHub workflow failed\n');
	expect(result.stdout.join('')).toContain(
		`Run: https://github.com/octo/widget/actions/runs/${repository.runs.at(-1)?.id}`,
	);
});

async function binaryStarts() {
	const repository = await cliStarts();
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.release.workflow.publications = ['pkg:npm/widget', 'github-release:octo/widget'];
	configuration.streams.main.release.workflow.setup = {
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

test('binary progress preserves waiting and cancelled GitHub states through the API and CLI', async () => {
	const repository = await binaryStarts();
	const name = 'Build widget (aarch64-apple-darwin)';
	const steps = [
		() => world.wait(16_000),
		async () => {
			passChecks(repository, world.github.head(repository));
			await world.push(repository);
			await world.wait(16_000);
		},
		async () => {
			const workflow = repository.runs.at(-1);
			if (!workflow) throw new Error('No run');
			const id = workflow.inputs.beepboop_execution_id ?? '';
			workflow.status = 'in_progress';
			await begin(world, runIdentity(repository, workflow, 'publish.yml'), id, 'main', 'release');
			for (const status of ['queued', 'requested', 'pending', 'waiting', 'in_progress']) {
				workflow.jobs = [{ name, status, conclusion: null }];
				const progress = await Effect.runPromise(client.call(routes.executionsBinaries, { id }));
				expect(progress.legs.find(leg => leg.job === name)).toMatchObject({
					state: status === 'in_progress' ? 'running' : 'waiting',
					status,
					conclusion: null,
				});
			}
			const legacyState = mutableArray(
				mutableStruct({ state: Schema.Literals(['waiting', 'running', 'succeeded', 'failed', 'skipped']) }),
			);
			for (const conclusion of [
				'success',
				'failure',
				'cancelled',
				'skipped',
				'neutral',
				'timed_out',
				'action_required',
				'startup_failure',
				'stale',
				'future_conclusion',
				null,
			]) {
				workflow.jobs = [{ name, status: 'completed', conclusion }];
				const progress = await Effect.runPromise(client.call(routes.executionsBinaries, { id }));
				expect(safeDecode(legacyState, progress.legs).success).toBe(true);
			}
			workflow.jobs = [{ name, status: 'future_status', conclusion: null }];
			const unknown = await Effect.runPromise(client.call(routes.executionsBinaries, { id }));
			expect(unknown.legs.find(leg => leg.job === name)).toMatchObject({ state: 'waiting', kind: 'unknown' });
			workflow.jobs = [
				{ name, status: 'completed', conclusion: 'cancelled', runner_id: 7, steps: [{}] },
				{ name: 'Build widget (x86_64-unknown-linux-gnu)', status: 'completed', conclusion: 'success' },
			];
			const progress = await Effect.runPromise(client.call(routes.executionsBinaries, { id }));
			expect(progress.legs.find(leg => leg.job === name)).toMatchObject({
				state: 'failed',
				kind: 'cancelled',
				status: 'completed',
				conclusion: 'cancelled',
			});
		},
		async () => {
			const workflow = repository.runs.at(-1);
			if (!workflow) throw new Error('No run');
			workflow.status = 'completed';
			workflow.conclusion = 'failure';
			await world.workflowRun(repository, workflow, 'failure', 'workflow_dispatch');
			await world.wait(16_000);
		},
	];
	spyOn(client, 'pause').mockImplementation(() => Effect.promise(async () => {
		await (steps.shift() ?? (() => world.wait(16_000)))();
	}));
	const result = await run(['release', 'patch', '--repository', repository.name], [true]);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr.join('')).toContain('GitHub workflow failed');
	expect(result.stdout.join('')).toContain('cancelled');
	expect(result.activity).toContainEqual({ type: 'progress:fail', text: '1 of 2 builds failed' });
});

test.each([false, true])('release follows each binary build leg and asset upload (legacy server: %s)', async legacy => {
	const repository = await binaryStarts();
	if (legacy) {
		world.network.serve(new URL(origin).host, async request => {
			const response = await world.handle(request);
			if (new URL(request.url).pathname !== routes.executionsBinaries.path || !response.ok) return response;
			const progress = decodeSync(binaryProgress, await response.json());
			for (const leg of progress.legs) {
				delete leg.kind;
				delete leg.status;
				delete leg.conclusion;
			}
			return Response.json(progress);
		});
	}

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
				'release',
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
		'start Publishing 1',
		'update 0',
		'start Uploading assets 2',
		'update 0',
		'update 2',
		'done Built 2 binaries',
		'update 1',
		'done Published 1 of 1',
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
				'release',
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
	expect(result.activity.filter(event => event.type === 'progress:fail')).toEqual([
		{ type: 'progress:fail', text: '2 of 2 builds failed' },
		{ type: 'progress:fail', text: undefined },
		{ type: 'progress:fail', text: undefined },
	]);
	expect(result.stderr.join('')).toContain(
		'GitHub workflow failed: Build widget (x86_64-unknown-linux-gnu) (cancelled), Build widget (aarch64-apple-darwin) (failed)',
	);
	const output = result.stdout.join('');
	expect(output).toContain('widget  linux-amd64   ✖ cancelled');
	expect(output).toContain('widget  darwin-arm64  ✖ failed');
});

async function publishedAfterFailedRun(refs: boolean, conclusion: 'failure' | 'cancelled' = 'failure') {
	const stopped = conclusion === 'failure' ? 'failed' : 'cancelled';
	const repository = await binaryStarts();
	if (refs) {
		const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
		configuration.streams.main.release.workflow.refs = { phase: 'version', prefix: 'v' };
		const head = world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Tag it');
		passChecks(repository, head.sha);
		await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	}
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
				{ name: 'Build widget (x86_64-unknown-linux-gnu)', status: 'completed', conclusion: 'success' },
				{ name: 'Build widget (aarch64-apple-darwin)', status: 'completed', conclusion: 'success' },
			];
			const identity = runIdentity(repository, run, 'publish.yml');
			await begin(world, identity, run.inputs.beepboop_execution_id ?? '', 'main', 'release');
			world.npm.publish('widget', '1.0.1');
			await runAction(world, 'report', identity, {
				EXECUTION_ID: run.inputs.beepboop_execution_id ?? '',
				PUBLICATIONS: JSON.stringify([
					{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
				]),
			});
		},
		async () => {
			const run = dispatched();
			run.status = 'completed';
			run.conclusion = conclusion;
			await world.workflowRun(repository, run, conclusion, 'workflow_dispatch');
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
	const releaseExecution = async () => {
		const [found] = (await releaseExecutions()).filter(execution => execution.version === '1.0.1');
		if (!found) throw new Error('The release has no releaseExecution');
		return found;
	};
	expect((await releaseExecution()).state).toBe(stopped);
	const draft = repository.releases.find(release => release.draft);
	if (!draft) throw new Error('The release has no draft');
	draft.assets = ['widget-x86_64-unknown-linux-gnu', 'widget-aarch64-apple-darwin'];
	expect((await world.releasePublished(repository, 'v1.0.1')).status).toBe(202);
	await world.wait(16_000);
	expect((await releaseExecution()).state).toBe(stopped);
	world.github.recordTag(repository, 'v1.0.1', 'a'.repeat(40), world.github.head(repository), true);
	expect((await world.releasePublished(repository, 'v1.0.1')).status).toBe(202);
	await world.wait(16_000);
	expect((await releaseExecution()).state).toBe(stopped);
	draft.draft = false;
	expect((await world.releasePublished(repository, 'v9.9.9')).status).toBe(202);
	await world.wait(16_000);
	expect((await releaseExecution()).state).toBe(stopped);
	expect((await world.releasePublished(repository, 'v1.0.1')).status).toBe(202);
	await world.wait(16_000);
	const settled = await releaseExecution();
	expect([settled.state, settled.reason]).toEqual(['succeeded', conclusion === 'failure' ? runFailedNote : undefined]);
	return decodeSync(
		mutableArray(looseStruct({ id: Schema.String, outcome: Schema.String })),
		settled.publications,
	).map(publication => [publication.id, publication.outcome]).sort();
}

test('a release published after its run failed settles the failed operation', async () => {
	expect(await publishedAfterFailedRun(false)).toEqual([
		['pkg:github/octo/widget', 'succeeded'],
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('a release published after its run was cancelled settles the cancelled operation', async () => {
	expect(await publishedAfterFailedRun(false, 'cancelled')).toEqual([
		['pkg:github/octo/widget', 'succeeded'],
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('a release published after its run failed also records the tags the operation had to push', async () => {
	expect(await publishedAfterFailedRun(true)).toEqual([
		['pkg:github/octo/widget', 'succeeded'],
		['pkg:npm/widget', 'succeeded'],
		['refs:release', 'succeeded'],
	]);
});

async function publishedBeforeFailedRun(readable: boolean) {
	const repository = await binaryStarts();
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
				{ name: 'Build widget (x86_64-unknown-linux-gnu)', status: 'completed', conclusion: 'success' },
				{ name: 'Build widget (aarch64-apple-darwin)', status: 'completed', conclusion: 'success' },
			];
			const identity = runIdentity(repository, run, 'publish.yml');
			await begin(world, identity, run.inputs.beepboop_execution_id ?? '', 'main', 'release');
			world.npm.publish('widget', '1.0.1');
			await runAction(world, 'report', identity, {
				EXECUTION_ID: run.inputs.beepboop_execution_id ?? '',
				PUBLICATIONS: JSON.stringify([
					{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
				]),
			});
		},
		async () => {
			const run = dispatched();
			const draft = repository.releases.find(release => release.draft);
			if (!draft) throw new Error('The release has no draft');
			draft.assets = ['widget-x86_64-unknown-linux-gnu', 'widget-aarch64-apple-darwin'];
			draft.draft = false;
			world.github.recordTag(repository, 'v1.0.1', 'a'.repeat(40), world.github.head(repository), true);
			expect((await world.releasePublished(repository, 'v1.0.1')).status).toBe(202);
			await world.wait(16_000);
			if (!readable) {
				world.network.serve('api.github.com', request =>
					new URL(request.url).pathname === '/graphql'
						? new Response(null, { status: 500 })
						: world.github.handle(request));
			}
			run.status = 'completed';
			run.conclusion = 'failure';
			await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
			await world.wait(16_000);
			world.network.serve('api.github.com', request => world.github.handle(request));
		},
	];
	spyOn(client, 'pause').mockImplementation(() =>
		Effect.promise(async () => {
			await (steps.shift() ?? (() => world.wait(16_000)))();
		})
	);
	await run(['release', 'patch', '--repository', repository.name], [true]);
	const [releaseExecution] = (await releaseExecutions()).filter(execution => execution.version === '1.0.1');
	return [releaseExecution?.state, releaseExecution?.reason];
}

test('a release published before its failed run is observed settles when the run ends', async () => {
	expect(await publishedBeforeFailedRun(true)).toEqual(['succeeded', runFailedNote]);
});

test('a failed run stays failed and logs the release check when GitHub cannot list the tags', async () => {
	const logged = loggedErrors();
	expect((await publishedBeforeFailedRun(false))[0]).toBe('failed');
	expect(logged.events()).toContainEqual(expect.objectContaining({
		event: 'release.recheck-failed',
		executionId: expect.any(String),
		error: expect.any(String),
	}));
});

test('--auto, --no-auto and --merge send this release its version PR merge', async () => {
	const repository = await seed();
	const previewed = async (...flags: string[]) => {
		const result = await run(['release', 'patch', '--repository', repository.name, '--json', ...flags]);
		expect(result.exitCode).toBe(0);
		return decodeSync(looseStruct({}), JSON.parse(result.stdout.join(''))).versionPrMerge;
	};
	expect(await previewed()).toBeUndefined();
	expect(await previewed('--auto')).toBe('squash');
	expect(await previewed('--merge', 'rebase')).toBe('rebase');
	expect(await previewed('--auto', '--merge', 'merge')).toBe('merge');
	expect(await previewed('--no-auto')).toBe('manual');
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, { prepare: { strategy: 'managed', versionPrMerge: 'merge' } });
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Merge version PRs');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	expect(await previewed('--auto')).toBe('merge');
	const preview = await run(['release', 'patch', '--repository', repository.name, '--merge', 'rebase', '--dry-run']);
	expect(preview.stdout.join('')).toContain('Version PR: Beepboop turns on GitHub auto-merge, and GitHub rebases');
	expect(prepareCalls()).toHaveLength(0);
	const prepared = await run([
		'release',
		'patch',
		'--repository',
		repository.name,
		'--json',
		'--yes',
		'--merge',
		'rebase',
	]);
	expect(prepared.exitCode).toBe(0);
	expect(prepareCalls().map(call => decodeSync(looseStruct({}), call.body).versionPrMerge)).toEqual(['rebase']);
	const changed = await run(['release', 'patch', '--repository', repository.name, '--json', '--yes', '--no-auto']);
	expect(changed.exitCode).not.toBe(0);
	expect(changed.stdout.join('')).toContain('already being prepared with versionPrMerge rebase');
});

test('--no-auto with --merge, or any merge flag on a release without a version PR, prepares nothing', async () => {
	const repository = await seed();
	const refused = async (code: string, ...flags: string[]) => {
		const result = await run(['release', 'patch', '--repository', repository.name, '--json', '--yes', ...flags]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout.join('')).toContain(code);
	};
	await refused('INVALID_FLAGS', '--no-auto', '--merge', 'squash');
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, {
		prepare: { strategy: 'managed', versionLands: 'via-direct-commit' },
	});
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Commit version bumps');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	await refused('NO_VERSION_PR', '--auto');
	await refused('NO_VERSION_PR', '--no-auto');
	expect(prepareCalls()).toHaveLength(0);
});

test('merge flags refuse a release that prepares in its own workflow or already carries its version', async () => {
	const { repository } = await delegated();
	const workflow = await run(['release', '1.2.4', '--repository', repository.name, '--json', '--yes', '--auto']);
	expect(workflow.exitCode).not.toBe(0);
	expect(workflow.stdout.join('')).toContain('NO_VERSION_PR');
	const configuration = widgetStreams();
	configuration.streams.main = withMain(configuration, {
		prepare: { strategy: 'managed' },
		credentials: [],
	});
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'package.json': npmManifest('widget', '1.2.4'),
	}, 'Raise the version and start from the CLI');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const raised = await run([
		'release',
		'1.2.4',
		'--repository',
		repository.name,
		'--json',
		'--yes',
		'--merge',
		'squash',
	]);
	expect(raised.exitCode).not.toBe(0);
	expect(raised.stdout.join('')).toContain('NO_VERSION_PR');
	expect(prepareCalls()).toHaveLength(0);
});
