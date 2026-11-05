import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { z } from 'zod';
import { parseSetupPlan } from '@/automation/setup-plan';
import { app } from '@/cli/cli';
import { Client } from '@/cli/client';
import { routes } from '@/contract/routes';
import { widget } from '@root/test/support/repositories.ts';
import { origin, World } from '@root/test/support/world.ts';

let world: World;
let directory: string;
let client: Client;
beforeEach(async () => {
	world = await World.create();
	directory = await mkdtemp(join(tmpdir(), 'beepboop-adopt-'));
	client = await Effect.runPromise(Client.at(origin, directory));
	await Effect.runPromise(client.save({ token: await world.cliSession() }));
	spyOn(Client, 'at').mockReturnValue(Effect.succeed(client));
});
afterEach(async () => {
	world.dispose();
	await rm(directory, { recursive: true, force: true });
});
const run = (args: string[], answers?: unknown[]) =>
	app.execute(['repositories', ...args], { answers, isTTY: true, env: {} });

test('adopt enrolls a repository, reviews generated files and only opens a PR after confirmation', async () => {
	const repository = widget(world.github, { configured: false });
	const original = world.github.head(repository);
	const declined = await run(['adopt', repository.name], ['new', '', 'managed', false, false]);
	expect(declined.exitCode).toBe(0);
	expect(declined.stdout.join('')).toContain('release-widget.yml');
	expect(repository.pulls).toHaveLength(0);
	expect((await Effect.runPromise(client.call(routes.repositoriesList, {}))).map(row => row.name)).toContain(
		repository.name,
	);
	const accepted = await run(['adopt', `https://github.com/${repository.name}`], ['new', '', 'managed', false, true]);
	expect(accepted.exitCode).toBe(0);
	expect(repository.pulls).toHaveLength(1);
	expect(world.github.head(repository)).toBe(original);
	expect(world.github.file(repository, '.github/workflows/release-widget.yml', 'automation/onboarding')).toContain(
		'run: npm publish',
	);
	expect(accepted.stdout.join('')).toContain('/pull/1');
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
	const result = await run(['adopt', repository.name], [
		'new',
		'',
		'same',
		'',
		true,
		false,
		'workspace',
		'my-release.yml',
		'',
		true,
	]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.join('')).toContain('Cargo.lock must be updated');
	const source = world.github.file(repository, '.github/workflows/my-release.yml', 'automation/onboarding') ?? '';
	expect(source).toContain("cargo publish --package 'my-crate'");
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
	const refreshed = await run(['adopt', repository.name], ['new', '', 'same', '', false, true]);
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
	const result = await run(['adopt', repository.name], [
		true,
		'ship.yml',
		'ship',
		'publish_a',
		'',
		'',
		'managed',
		false,
		true,
	]);
	expect(result.exitCode).toBe(0);
	const workflow = z.object({
		jobs: z.object({
			ship: z.object({
				steps: z.array(
					z.object({
						id: z.string().optional(),
						run: z.string().optional(),
						with: z.object({ publications: z.string().optional() }).passthrough().optional(),
					}).passthrough(),
				),
			}),
		}),
	}).parse(parse(world.github.file(repository, '.github/workflows/ship.yml', 'automation/onboarding') ?? ''));
	const steps = workflow.jobs.ship.steps;
	expect(steps.find(step => step.id === 'beepboop_publish')?.run).toBe("(cd 'packages/b' &&\nnpm publish\n)");
	const publications = z.array(z.object({ name: z.string(), outcome: z.string() })).parse(
		JSON.parse(steps.find(step => step.with?.publications)?.with?.publications ?? '[]'),
	);
	expect(publications.find(pkg => pkg.name === 'package-a')?.outcome).toContain('steps.publish_a.outcome');
	expect(publications.find(pkg => pkg.name === 'package-b')?.outcome).toContain('steps.beepboop_publish.outcome');
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
	// Empty input retries: there is no guessed command to accept for descriptor-backed packages.
	const result = await run(['adopt', repository.name], [
		true,
		'new',
		'',
		'./scripts/generate-and-publish.sh',
		'managed',
		false,
		true,
	]);
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
	const preview = await run(['adopt', repository.name, '--choices', choices, '--output', output, '--json']);
	expect(preview.exitCode).toBe(0);
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
	expect(stale.stderr.join('')).toContain('preview again');
	expect((await run(['adopt', repository.name, '--choices', choices, '--output', output, '--json'])).exitCode).toBe(0);
	const applied = await run(['adopt', repository.name, '--plan', output, '--apply', '--json']);
	expect(applied.exitCode).toBe(0);
	expect(repository.pulls).toHaveLength(1);
	expect(JSON.parse(applied.stdout.join(''))).toHaveProperty('url');
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
