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
import { publishWorkflow, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
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
	const result = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
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
