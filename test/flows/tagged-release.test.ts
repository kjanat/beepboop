import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { z } from 'zod';
import { parseSetupPlan } from '@/automation/setup-plan';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { commitAll, gitOutput, materialize, runAction, runRuntime } from '@root/test/support/actions.ts';
import { botId, ownerId, type Repository } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { passChecks } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

const releaseWorkflow = `name: Release
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
  pypi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: uv build --directory bindings/python
      - uses: pypa/gh-action-pypi-publish@release/v1
`;

function lintRepository(): Repository {
	return world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n\n[workspace.package]\nversion = "1.0.0"\n',
		'Cargo.lock': '# Lockfile\n',
		'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
		'crates/cli/Cargo.toml':
			'[package]\nname = "lint"\nversion.workspace = true\n\n[dependencies]\nlint-core = { path = "../core", version = "1.0.0" }\n',
		'bindings/js/package.json': '{\n  "name": "@octo/lint",\n  "version": "1.0.0"\n}\n',
		'bindings/python/pyproject.toml': '[project]\nname = "lint-py"\nversion = "1.0.0"\n',
		'go/go.mod': 'module github.com/octo/lint/go\n\ngo 1.26\n',
		'.github/workflows/release.yml': releaseWorkflow,
	});
}

function filesAt(repository: Repository, sha: string): Record<string, string> {
	const tree = repository.trees.get(repository.commits.get(sha)?.tree ?? '');
	if (!tree) throw new Error('Missing tree');
	return Object.fromEntries(tree);
}

function one<T>(items: T[], label: string): T {
	const [item] = items;
	if (items.length !== 1 || item === undefined) throw new Error(`Expected one ${label}, found ${items.length}`);
	return item;
}

async function completed(repository: Repository, run: { id: number; path: string }, event: string) {
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: { id: run.id, conclusion: 'success', event, path: run.path, head_repository: { id: repository.id } },
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
}

const refPlan = z.object({ changes: z.array(z.object({ name: z.string(), commit: z.string() })) });

test('a bare adoption releases crates, Go modules and the tag-triggered npm workflow from one approval', async () => {
	const published = new Map<string, string>();
	world.network.serve('crates.io', request => {
		const [, , , , name, version] = new URL(request.url).pathname.split('/');
		if (!name) return new Response(null, { status: 404 });
		if (!version) return Response.json({ crate: { max_version: '1.0.0' } });
		return published.get(`${name}@${version}`) === 'crate'
			? Response.json({ version: { crate: name, num: version, yanked: false, checksum: 'c'.repeat(64) } })
			: new Response(null, { status: 404 });
	});
	world.network.serve('proxy.golang.org', request => {
		const path = new URL(request.url).pathname;
		if (path.endsWith('/@latest')) {
			const latest = [...published.keys()].filter(key => key.startsWith('go@')).map(key => key.slice(3)).at(-1);
			return latest ? Response.json({ Version: latest }) : new Response(null, { status: 404 });
		}
		const version = /\/@v\/(v[^/]+)\.info$/.exec(path)?.[1];
		return version && published.get(`go@${version}`) === 'module'
			? Response.json({ Version: version })
			: new Response(null, { status: 404 });
	});
	for (const name of ['lint-core', 'lint']) published.set(`${name}@1.0.0`, 'crate');
	published.set('go@v1.0.0', 'module');
	world.npm.publish('@octo/lint', '1.0.0');
	const repository = lintRepository();
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	expect(plan.blockers).toEqual([]);
	const [stream] = plan.choices.streams;
	if (!stream) throw new Error('No proposed stream');
	expect([...stream.packages].sort()).toEqual([
		'pkg:cargo/lint',
		'pkg:cargo/lint-core',
		'pkg:golang/github.com/octo/lint/go',
		'pkg:npm/%40octo/lint',
	]);
	expect(stream.versionFiles).toEqual([
		{ path: 'bindings/python/pyproject.toml', format: 'toml', key: ['project', 'version'], template: '{version}' },
	]);
	expect(stream.prepare).toEqual({
		file: 'prepare-release.yml',
		triggers: 'review',
		commands: 'cargo update --workspace',
		publicationSteps: {},
	});
	expect(stream.promote).toEqual({
		file: 'release-crates.yml',
		triggers: 'review',
		commands: "cargo publish --locked --package 'lint-core'\ncargo publish --locked --package 'lint'",
		publicationSteps: {},
		credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
		tagPrefix: 'lint-v',
	});
	expect(stream.observe?.find(entry => entry.ref === 'refs/tags/lint-v*')?.publications).toEqual([
		'pkg:npm/%40octo/lint',
	]);
	const generated = plan.edits.find(edit => edit.path === '.github/workflows/release-crates.yml')?.after ?? '';
	const steps = z.object({
		jobs: z.object({ promote: z.object({ steps: z.array(z.looseObject({ id: z.string().optional() })) }) }),
	}).parse(parse(generated)).jobs.promote.steps.map(step => step.id);
	expect(steps.filter(id => id?.startsWith('beepboop_'))).toEqual([
		'beepboop_credentials',
		'beepboop_publish',
		'beepboop_token',
		'beepboop_refs',
	]);
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(200);
	const setup = world.github.merge(repository, 1);
	const checkout = materialize(filesAt(repository, setup.sha));
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-chain-'));
	try {
		world.github.relabel(repository, setup.sha, checkout.sha);
		passChecks(repository, checkout.sha);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const request = { repositoryId: repository.id, stream: stream.name, version: '1.1.0' };
		const release = await api('/api/releases/plan', request);
		expect(release.status).toBe(200);
		const prepared = await api('/api/releases/prepare', {
			...request,
			sourceSha: text(release.body, 'sourceSha'),
			planId: text(release.body, 'planId'),
		});
		expect(prepared.status).toBe(200);
		await world.wait(20_000);
		const prepareRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/prepare-release.yml'),
			'prepare run',
		);
		const prepareIdentity = {
			repository,
			runId: prepareRun.id,
			sha: prepareRun.headSha,
			file: 'prepare-release.yml',
			actorId: botId,
		};
		const begun = await runAction(world, 'begin', prepareIdentity, {
			EXECUTION_ID: text(prepared.body, 'id'),
			STREAM: stream.name,
			OPERATION: 'prepare',
		});
		const context = begun.outputs.context ?? '';
		const environment = join(scratch, 'env'), runner = join(scratch, 'runner');
		writeFileSync(environment, '');
		mkdirSync(runner);
		await runRuntime('prepare', {
			RELEASE_CONTEXT: context,
			PREPARATION_MODE: 'apply',
			GITHUB_WORKSPACE: checkout.dir,
		});
		expect(readFileSync(join(checkout.dir, 'Cargo.toml'), 'utf8')).toContain('version = "1.1.0"');
		expect(readFileSync(join(checkout.dir, 'bindings/js/package.json'), 'utf8')).toContain('"version": "1.1.0"');
		expect(readFileSync(join(checkout.dir, 'bindings/python/pyproject.toml'), 'utf8')).toContain('version = "1.1.0"');
		await runRuntime('prepare', {
			RELEASE_CONTEXT: context,
			PREPARATION_MODE: 'submit',
			GITHUB_WORKSPACE: checkout.dir,
			GITHUB_ENV: environment,
			RUNNER_TEMP: runner,
		});
		const file = /^PREPARED_FILE=(.+)$/m.exec(readFileSync(environment, 'utf8'))?.[1];
		if (!file) throw new Error('Prepare submit wrote no PREPARED_FILE');
		await runAction(world, 'prepared', prepareIdentity, { PREPARED_FILE: file });
		prepareRun.status = 'completed';
		prepareRun.conclusion = 'success';
		await completed(repository, prepareRun, 'workflow_dispatch');

		const pull = one(repository.pulls.filter(entry => entry.state === 'open'), 'preparation pull request');
		const released = commitAll(checkout.dir, 'Release 1.1.0');
		const merged = world.github.merge(repository, pull.number);
		world.github.relabel(repository, merged.sha, released);
		passChecks(repository, released);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(1_000);
		const listed = await api('/api/executions');
		const promotions = z.array(z.unknown()).parse(listed.body).map(decodeExecutionV1).filter(entry =>
			entry.operation === 'promote'
		);
		const promotion = one(promotions, 'promotion');
		expect(promotion.state).toBe('awaiting-approval');
		const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: released });
		expect(text(approved.body, 'state')).toBe('ready');
		await world.wait(16_000);

		const promoteRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/release-crates.yml'),
			'crates run',
		);
		const identity = {
			repository,
			runId: promoteRun.id,
			sha: promoteRun.headSha,
			file: 'release-crates.yml',
			actorId: botId,
		};
		await runAction(world, 'begin', identity, {
			EXECUTION_ID: promotion.id,
			STREAM: stream.name,
			OPERATION: 'promote',
		});
		published.set('lint-core@1.1.0', 'crate');
		published.set('lint@1.1.0', 'crate');
		const planned = await runAction(world, 'refs-plan', identity, { EXECUTION_ID: promotion.id });
		const changes = refPlan.parse(JSON.parse(planned.outputs.result ?? '')).changes;
		expect(changes.map(change => change.name)).toEqual(['lint-v1.1.0', 'go/v1.1.0']);
		for (const [index, change] of changes.entries()) {
			world.github.recordTag(repository, change.name, String(index + 1).repeat(40), change.commit, true);
		}
		await runAction(world, 'refs-complete', identity, { EXECUTION_ID: promotion.id });
		published.set('go@v1.1.0', 'module');
		const outcome = (step: string) => ({ outcome: step, required: true, version: '1.1.0' });
		await runAction(world, 'report', identity, {
			EXECUTION_ID: promotion.id,
			PUBLICATIONS: JSON.stringify([
				{ id: 'pkg:cargo/lint-core', manager: 'cargo', name: 'lint-core', ...outcome('succeeded') },
				{ id: 'pkg:cargo/lint', manager: 'cargo', name: 'lint', ...outcome('succeeded') },
				{
					id: 'pkg:golang/github.com/octo/lint/go',
					manager: 'go',
					name: 'github.com/octo/lint/go',
					...outcome('succeeded'),
				},
			]),
		});
		promoteRun.status = 'completed';
		promoteRun.conclusion = 'success';
		await completed(repository, promoteRun, 'workflow_dispatch');

		world.npm.publish('@octo/lint', '1.1.0');
		const tagRun = {
			id: 9100,
			path: '.github/workflows/release.yml',
			event: 'push',
			headSha: released,
			headBranch: 'lint-v1.1.0',
			status: 'completed' as const,
			conclusion: 'success',
			attempt: 1,
			title: 'Release',
			inputs: {},
		};
		repository.runs.push(tagRun);
		await completed(repository, tagRun, 'push');

		const journal = await world.coordinator(repository).exportJournal();
		const executions = journal.filter(entry => entry.key.startsWith('execution:')).map(entry =>
			decodeExecutionV1(entry.value)
		);
		const outcomes = (operation: string) =>
			executions.filter(entry => entry.operation === operation).flatMap(entry =>
				entry.publications.filter(publication => publication.id.startsWith('pkg:')).map(
					publication => [publication.id, publication.version, publication.outcome],
				)
			).sort();
		expect(executions.find(entry => entry.operation === 'promote')?.state).toBe('succeeded');
		expect(outcomes('promote')).toEqual([
			['pkg:cargo/lint', '1.1.0', 'succeeded'],
			['pkg:cargo/lint-core', '1.1.0', 'succeeded'],
			['pkg:golang/github.com/octo/lint/go', '1.1.0', 'succeeded'],
		]);
		expect(outcomes('release')).toEqual([['pkg:npm/%40octo/lint', '1.1.0', 'succeeded']]);
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}, 60_000);
