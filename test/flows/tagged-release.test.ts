import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { begin, commitAll, materialize, runAction, runIdentity, runRuntime } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId, filesAt, ownerId } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { cargoMetadata, crateChecksum, crateListing, packCrate, publishWith } from '@root/test/support/ledger.ts';
import { one } from '@root/test/support/lists.ts';
import { crateResponse, pypiResponse } from '@root/test/support/registries.ts';
import { approvePromotion, executions, prepareRelease } from '@root/test/support/releases.ts';
import {
	crateMetadata,
	licenseText,
	npmManifest,
	passChecks,
	pythonMetadata,
} from '@root/test/support/repositories.ts';
import { applySetup, discoverSetup, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { z } from 'zod';
import { setupOptions } from '@/automation/setup';
import { ledgerCommand } from '@/automation/setup-defaults';
import { streamSummary } from '@/automation/setup-summary';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

let world: World;
eachWorld(created => {
	world = created;
});

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
  github:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: gh release create "$GITHUB_REF_NAME" dist/*
`;

const stagedWorkflow = `name: Release
on:
  push:
    tags: ['lint-v*']
jobs:
  plan:
    name: Plan release
    runs-on: ubuntu-latest
    steps:
      - run: echo plan
  build:
    name: \${{ matrix.target }}
    needs: plan
    strategy:
      matrix:
        target: [linux, macos]
    runs-on: ubuntu-latest
    steps:
      - run: echo build
  assemble:
    name: Assemble payload
    needs: [plan, build]
    runs-on: ubuntu-latest
    steps:
      - run: echo assemble
  github:
    needs: assemble
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: gh release create "$GITHUB_REF_NAME" dist/*
  npm:
    needs: github
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: npm publish
        working-directory: bindings/js
  pypi:
    needs: github
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: uv build --directory bindings/python
      - uses: pypa/gh-action-pypi-publish@release/v1
`;

function lintRepository(workflow = releaseWorkflow): Repository {
	return world.github.create('octo/lint', {
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n\n[workspace.package]\nversion = "1.0.0"\n',
		'Cargo.lock': '# Lockfile\n',
		'README.md': '# lint\n',
		LICENSE: licenseText,
		'crates/core/Cargo.toml': `[package]\nname = "lint-core"\nversion.workspace = true\n${crateMetadata}`,
		'crates/cli/Cargo.toml':
			`[package]\nname = "lint"\nversion.workspace = true\n${crateMetadata}\n[dependencies]\nlint-core = { path = "../core", version = "1.0.0" }\n`,
		'bindings/js/package.json': npmManifest('@octo/lint', '1.0.0'),
		'bindings/js/README.md': '# lint\n',
		'bindings/js/LICENSE': licenseText,
		'bindings/python/LICENSE': licenseText,
		'bindings/python/pyproject.toml': `[project]\nname = "lint-py"\nversion = "1.0.0"\n${pythonMetadata}`,
		'go/go.mod': 'module github.com/octo/lint/go\n\ngo 1.26\n',
		'.github/workflows/release.yml': workflow,
	});
}

async function completed(repository: Repository, run: { id: number; path: string }, event: string) {
	await world.workflowRun(repository, run, 'success', event);
	await world.wait(2_000);
}

function unpublished() {
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	world.network.serve('pypi.org', () => new Response(null, { status: 404 }));
	world.network.serve('proxy.golang.org', () => new Response(null, { status: 404 }));
}

const refPlan = z.object({ changes: z.array(z.object({ name: z.string(), commit: z.string() })) });

test('one approval pushes the tags, then the tag workflow publishes, then the crates publish', async () => {
	const published = new Map<string, string>();
	world.network.serve('crates.io', request =>
		crateResponse(request, (name, version) => {
			const crate = published.get(`${name}@${version}`);
			return crate?.startsWith('crate') ? crate.slice('crate:'.length) || 'c'.repeat(64) : undefined;
		}));
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
	published.set('lint-py@1.0.0', 'project');
	world.network.serve('pypi.org', request =>
		pypiResponse(request, name => {
			const known = [...published.keys()].filter(key => key.startsWith(`${name}@`)).map(key =>
				key.slice(`${name}@`.length)
			);
			if (!name || !known.length) return undefined;
			return {
				latest: known.at(-1),
				files: version =>
					known.includes(version)
						? [{ packagetype: 'sdist', yanked: false, digests: { sha256: 'd'.repeat(64) } }]
						: undefined,
			};
		}));
	const repository = lintRepository();
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	const plan = await discoverSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	const [stream] = plan.choices.streams;
	if (!stream) throw new Error('No proposed stream');
	expect([...stream.packages].sort()).toEqual([
		'pkg:cargo/lint',
		'pkg:cargo/lint-core',
		'pkg:golang/github.com/octo/lint/go',
		'pkg:npm/%40octo/lint',
		'pkg:pypi/lint-py',
	]);
	expect(stream.versionFiles).toBeUndefined();
	expect(stream.prepare).toEqual({
		file: 'prepare-release.yml',
		triggers: 'review',
		commands: 'cargo update --workspace\ncargo test --workspace --locked',
		publicationSteps: {},
	});
	expect(stream.promote).toEqual({
		file: 'release-lint.yml',
		triggers: 'review',
		commands: '',
		publicationSteps: {},
		tagPrefix: 'lint-v',
	});
	expect(stream.observe).toEqual([{
		name: 'release',
		file: 'release.yml',
		ref: 'refs/tags/lint-v*',
		publications: ['pkg:npm/%40octo/lint', 'pkg:pypi/lint-py', 'pkg:github/octo/lint'],
		needs: ['promote'],
	}]);
	expect(stream.operations).toEqual([{
		name: 'crates',
		file: 'publish-crates.yml',
		triggers: 'review',
		commands: ledgerCommand,
		publicationSteps: {},
		credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
		needs: ['release'],
		publications: ['pkg:cargo/lint-core', 'pkg:cargo/lint'],
	}]);
	const module = 'pkg:golang/github.com/octo/lint/go', github = 'pkg:github/octo/lint';
	const registries = ['pkg:npm/%40octo/lint', 'pkg:pypi/lint-py', github];
	expect(stream.needs).toEqual({
		'pkg:npm/%40octo/lint': [module],
		'pkg:pypi/lint-py': [module],
		[github]: [module],
		'pkg:cargo/lint-core': registries,
		'pkg:cargo/lint': [...registries, 'pkg:cargo/lint-core'],
	});
	const configured = z.object({
		streams: z.record(
			z.string(),
			z.looseObject({
				needs: z.record(z.string(), z.array(z.string())),
				promote: z.looseObject({ workflow: z.looseObject({ publications: z.array(z.string()) }) }),
				workflows: z.record(z.string(), z.looseObject({ needs: z.array(z.string()).optional() })),
			}),
		),
	}).parse(JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'));
	expect(configured.streams[stream.name]?.needs).toEqual(stream.needs);
	expect(configured.streams[stream.name]?.promote.workflow.publications).toEqual([module]);
	expect(configured.streams[stream.name]?.workflows.release?.needs).toEqual(['promote']);
	expect(configured.streams[stream.name]?.workflows.crates?.needs).toEqual(['release']);
	const stepIds = (file: string, job: string) =>
		z.object({ jobs: z.record(z.string(), z.object({ steps: z.array(z.looseObject({ id: z.string().optional() })) })) })
			.parse(parse(plan.edits.find(edit => edit.path === `.github/workflows/${file}`)?.after ?? ''))
			.jobs[job]?.steps.flatMap(step => step.id?.startsWith('beepboop_') ? [step.id] : []);
	expect(stepIds('release-lint.yml', 'promote')).toEqual(['beepboop_token', 'beepboop_refs']);
	expect(stepIds('publish-crates.yml', 'crates')).toEqual(['beepboop_publish']);
	const source = (file: string) => plan.edits.find(edit => edit.path === `.github/workflows/${file}`)?.after ?? '';
	expect(
		['release-lint.yml', 'publish-crates.yml'].map(file =>
			z.object({ name: z.string() }).parse(parse(source(file))).name
		),
	)
		.toEqual(['Publish lint', 'Publish lint crates']);
	expect(source('publish-crates.yml')).toContain(
		`        uses: kjanat/beepboop/actions/publish@v1\n        with:\n          execution-id: \${{ steps.beepboop.outputs.execution-id }}\n          credentials: '{"CARGO_REGISTRY_TOKEN":"crates-io"}'\n`,
	);
	expect(source('publish-crates.yml')).not.toContain('actions/report');
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	const setup = world.github.merge(repository, 1);
	const checkout = materialize(filesAt(repository, setup.sha));
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-chain-'));
	try {
		world.github.relabel(repository, setup.sha, checkout.sha);
		passChecks(repository, checkout.sha);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const { plan: release, prepared } = await prepareRelease(api, {
			repositoryId: repository.id,
			stream: stream.name,
			version: '1.1.0',
		});
		expect(release.status).toBe(200);
		expect(prepared.status).toBe(200);
		await world.wait(20_000);
		const prepareRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/prepare-release.yml'),
			'prepare run',
		);
		const prepareIdentity = runIdentity(repository, prepareRun, 'prepare-release.yml');
		const begun = await begin(world, prepareIdentity, text(prepared.body, 'id'), stream.name, 'prepare');
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
		const { promotion, approved } = await approvePromotion(api, released);
		expect(promotion.state).toBe('awaiting-approval');
		expect(text(approved.body, 'state')).toBe('ready');
		await world.wait(16_000);

		const runOf = (file: string) => {
			const run = one(repository.runs.filter(entry => entry.path === `.github/workflows/${file}`), file);
			return { run, identity: runIdentity(repository, run, file) };
		};
		const outcome = (state: string) => ({ outcome: state, required: true, version: '1.1.0' });
		const tags = runOf('release-lint.yml');
		await begin(world, tags.identity, promotion.id, stream.name, 'promote');
		const planned = await runAction(world, 'refs-plan', tags.identity, { EXECUTION_ID: promotion.id });
		const changes = refPlan.parse(JSON.parse(planned.outputs.result ?? '')).changes;
		expect(changes.map(change => change.name)).toEqual(['lint-v1.1.0', 'go/v1.1.0']);
		for (const [index, change] of changes.entries()) {
			world.github.recordTag(repository, change.name, String(index + 1).repeat(40), change.commit, true);
		}
		await runAction(world, 'refs-complete', tags.identity, { EXECUTION_ID: promotion.id });
		published.set('go@v1.1.0', 'module');
		await runAction(world, 'report', tags.identity, {
			EXECUTION_ID: promotion.id,
			PUBLICATIONS: JSON.stringify([
				{ id: module, manager: 'go', name: 'github.com/octo/lint/go', ...outcome('succeeded') },
			]),
		});
		tags.run.status = 'completed';
		tags.run.conclusion = 'success';
		await completed(repository, tags.run, 'workflow_dispatch');
		expect(repository.runs.filter(run => run.path === '.github/workflows/publish-crates.yml')).toEqual([]);

		world.npm.publish('@octo/lint', '1.1.0');
		published.set('lint-py@1.1.0', 'project');
		repository.releases.push({
			id: 1,
			tag: 'lint-v1.1.0',
			target: released,
			draft: false,
			prerelease: false,
			authorId: botId,
			body: '',
			assets: ['lint-x86_64-unknown-linux-gnu.tar.gz'],
		});
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
		await world.wait(16_000);

		const crates = runOf('publish-crates.yml');
		const crateExecution = one(
			(await executions(api)).filter(entry => entry.operation === 'crates'),
			'crates execution',
		);
		expect(crateExecution.version).toBe('1.1.0');
		expect(crateExecution.sourceSha).toBe(released);
		await begin(world, crates.identity, crateExecution.id, stream.name, 'crates');
		const crateNames: Record<string, string> = {
			'crates/core/Cargo.toml': 'lint-core',
			'crates/cli/Cargo.toml': 'lint',
		};
		const order: string[] = [];
		const { result } = await publishWith(world, crates.identity, crateExecution.id, {
			scratch,
			run: argv =>
				Effect.sync(() => {
					const name = crateNames[argv[argv.indexOf('--manifest-path') + 1] ?? ''] ?? '';
					if (argv[1] === 'metadata') return cargoMetadata(scratch);
					if (argv[2] === '--list') return crateListing();
					if (argv[1] === 'package') {
						packCrate(scratch, name, '1.1.0');
						return { code: 0, stdout: '', output: '' };
					}
					order.push(name);
					published.set(`${name}@1.1.0`, `crate:${crateChecksum(scratch, name, '1.1.0')}`);
					return { code: 0, stdout: '', output: '' };
				}),
		});
		if (result._tag === 'Failure') throw new Error(result.failure.message);
		expect(order).toEqual(['lint-core', 'lint']);
		crates.run.status = 'completed';
		crates.run.conclusion = 'success';
		await completed(repository, crates.run, 'workflow_dispatch');

		const journal = await world.coordinator(repository).exportJournal();
		const journaled = journal.filter(entry => entry.key.startsWith('execution:')).map(entry =>
			decodeExecutionV1(entry.value)
		);
		const outcomes = (operation: string) =>
			journaled.filter(entry => entry.operation === operation).flatMap(entry =>
				entry.publications.filter(publication => !publication.id.startsWith('refs:')).map(
					publication => [publication.id, publication.version, publication.outcome],
				)
			).sort();
		expect(journaled.map(entry => [entry.operation, entry.state]).sort()).toEqual([
			['crates', 'succeeded'],
			['prepare', 'succeeded'],
			['promote', 'succeeded'],
			['release', 'succeeded'],
		]);
		expect(outcomes('promote')).toEqual([[module, '1.1.0', 'succeeded']]);
		expect(outcomes('release')).toEqual([
			['pkg:github/octo/lint', 'lint-v1.1.0', 'succeeded'],
			['pkg:npm/%40octo/lint', '1.1.0', 'succeeded'],
			['pkg:pypi/lint-py', '1.1.0', 'succeeded'],
		]);
		expect(outcomes('crates')).toEqual([
			['pkg:cargo/lint', '1.1.0', 'succeeded'],
			['pkg:cargo/lint-core', '1.1.0', 'succeeded'],
		]);
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}, 60_000);

test('a Go module with its own released tags becomes its own stream', async () => {
	const repository = lintRepository();
	world.github.push(repository, { 'sdk/go.mod': 'module github.com/octo/lint/sdk\n\ngo 1.26\n' }, 'Add the SDK');
	repository.refs.set('tags/sdk/v0.3.0', world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	const plan = await previewSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	expect(plan.choices.streams.map(stream => [stream.name, stream.packages.filter(id => id.startsWith('pkg:golang/'))]))
		.toEqual([
			['lint', ['pkg:golang/github.com/octo/lint/go']],
			['sdk', ['pkg:golang/github.com/octo/lint/sdk']],
		]);
	expect(plan.choices.streams[1]).toEqual({
		name: 'sdk',
		packages: ['pkg:golang/github.com/octo/lint/sdk'],
		versioning: 'workspace',
		approval: 'push',
		required: ['pkg:golang/github.com/octo/lint/sdk'],
		versionSource: { kind: 'tags', prefix: 'sdk/v' },
		prepare: {
			file: 'prepare-sdk.yml',
			triggers: 'review',
			commands: "(cd 'sdk' && go mod tidy -diff)",
			publicationSteps: {},
		},
		promote: { file: 'release-sdk.yml', triggers: 'review', commands: '', publicationSteps: {}, tagPrefix: 'sdk/v' },
	});
	expect(plan.edits.map(edit => edit.path)).toEqual(expect.arrayContaining([
		'.github/workflows/prepare-sdk.yml',
		'.github/workflows/release-sdk.yml',
	]));
	const offered = (stream: string) =>
		setupOptions(plan).flatMap(option => option.kind === 'package' && option.stream === stream ? [option.package] : []);
	expect(offered('sdk')).toEqual(['pkg:golang/github.com/octo/lint/sdk']);
	expect(offered('lint')).not.toContain('pkg:golang/github.com/octo/lint/sdk');
});

async function mergedSetup(tamper: boolean, login = 'octo') {
	const repository = lintRepository();
	const api = bearer(world, await world.cliSession());
	const plan = await discoverSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	await world.sealCredential('crates-io');
	const foreign = {
		id: 'foreign',
		alias: 'crates-io',
		repositoryId: repository.id + 1,
		repository: 'octo/other',
		operation: 'crates',
		workflow: 'publish-crates.yml',
		ref: 'refs/heads/main',
		delivery: 'runtime',
	};
	await world.db.prepare('INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?)').bind(
		foreign.id,
		foreign.alias,
		foreign.repositoryId,
		JSON.stringify(foreign),
	).run();
	if (tamper) {
		world.github.push(
			repository,
			{
				'.github/workflows/publish-crates.yml': 'on: workflow_dispatch\njobs: {}\n',
			},
			'Change the crates workflow',
			'automation/onboarding',
		);
	}
	const merged = world.github.merge(repository, 1);
	await world.webhook('pull_request', {
		action: 'closed',
		pull_request: {
			number: 1,
			merged: true,
			merge_commit_sha: merged.sha,
			user: { id: botId },
			merged_by: { id: ownerId, login },
			head: { ref: 'automation/onboarding', repo: { id: repository.id } },
			base: { repo: { id: repository.id } },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const rows = await world.db.prepare('SELECT document FROM grants WHERE repository_id=?').bind(repository.id).all();
	return z.array(z.object({ document: z.string() })).parse(rows.results).map(row =>
		z.looseObject({ alias: z.string(), operation: z.string(), workflow: z.string(), ref: z.string() }).parse(
			JSON.parse(row.document),
		)
	);
}

test('merging the setup PR as the owner grants the credentials it requests', async () => {
	expect((await mergedSetup(false)).map(grant => [grant.alias, grant.operation, grant.workflow, grant.ref])).toEqual([
		['crates-io', 'crates', 'publish-crates.yml', 'refs/heads/main'],
	]);
});

test('a setup PR merged by someone else grants nothing', async () => {
	expect(await mergedSetup(false, 'mallory')).toEqual([]);
});

test('a setup PR whose generated files changed before the merge grants nothing', async () => {
	expect(await mergedSetup(true)).toEqual([]);
});

test('an uncustomized setup PR follows the current proposal when the default branch changes', async () => {
	const repository = lintRepository();
	const api = bearer(world, await world.cliSession());
	const plan = await discoverSetup(api, repository.name);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	world.github.push(repository, { 'sdk/go.mod': 'module github.com/octo/lint/sdk\n\ngo 1.26\n' }, 'Add the SDK');
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(5_000);
	const configured = z.object({ streams: z.record(z.string(), z.object({ packages: z.array(z.string()) })) }).parse(
		JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'),
	);
	expect(configured.streams.lint?.packages).toContain('pkg:golang/github.com/octo/lint/sdk');
	expect(repository.pulls).toHaveLength(1);
});

const passedBuild: NonNullable<Repository['runs'][number]['jobs']> = [
	{ name: 'Plan release', status: 'completed', conclusion: 'success' },
	{ name: 'linux', status: 'completed', conclusion: 'success' },
	{ name: 'macos', status: 'completed', conclusion: 'success' },
	{ name: 'Assemble payload', status: 'completed', conclusion: 'success' },
	{ name: 'github', status: 'completed', conclusion: 'success' },
];

async function stagedRelease() {
	unpublished();
	const repository = lintRepository(stagedWorkflow);
	const api = bearer(world, await world.cliSession());
	const plan = await discoverSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	const [stream] = plan.choices.streams;
	if (!stream) throw new Error('No proposed stream');
	expect(stream.operations?.map(entry => [entry.name, entry.needs, entry.needsJobs])).toEqual([
		['crates', ['release'], { release: ['plan', 'build', 'assemble'] }],
	]);
	expect(streamSummary(stream, plan)).toContain(
		'After the plan, build and assemble jobs of release.yml succeed, publish-crates.yml (new) publishes lint-core and lint to crates.io.',
	);
	const module = 'pkg:golang/github.com/octo/lint/go';
	expect(stream.needs?.['pkg:cargo/lint-core']).toEqual([module]);
	expect(stream.needs?.['pkg:cargo/lint']).toEqual([module, 'pkg:cargo/lint-core']);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	expect(one(repository.pulls, 'setup pull request').body).toContain(
		'  - After jobs `plan`, `build`, `assemble` of `release`: `publish-crates.yml`',
	);
	const merged = world.github.merge(repository, 1);
	passChecks(repository, merged.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const configured = z.object({
		streams: z.record(z.string(), z.object({ workflows: z.record(z.string(), z.looseObject({})) })),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}'));
	expect(configured.streams[stream.name]?.workflows.crates).toMatchObject({
		needs: ['release'],
		needsJobs: { release: ['plan', 'build', 'assemble'] },
	});
	repository.refs.set('tags/lint-v1.0.0', merged.sha);
	const run: Repository['runs'][number] = {
		id: 9200,
		path: '.github/workflows/release.yml',
		event: 'push',
		headSha: merged.sha,
		headBranch: 'lint-v1.0.0',
		status: 'in_progress',
		conclusion: null,
		attempt: 1,
		title: 'Release',
		inputs: {},
		jobs: [
			{ name: 'Plan release', status: 'completed', conclusion: 'success' },
			{ name: 'linux', status: 'completed', conclusion: 'success' },
			{ name: 'macos', status: 'in_progress', conclusion: null },
		],
	};
	repository.runs.push(run);
	const notify = async (action: string) => {
		await world.workflowRun(repository, run, run.conclusion, run.event, action);
	};
	await notify('in_progress');
	await world.wait(2_000);
	const crateRuns = () => repository.runs.filter(entry => entry.path === '.github/workflows/publish-crates.yml');
	const unpromoted = async () => (await executions(api)).filter(entry => entry.operation !== 'promote');
	expect(crateRuns()).toEqual([]);
	return { repository, run, notify, crateRuns, executions: unpromoted };
}

test('the crates start once the build jobs pass while npm still runs', async () => {
	const { run, notify, crateRuns, executions } = await stagedRelease();
	run.jobs = [
		...Array.from({ length: 120 }, (_, index) => ({
			name: `lint ${index}`,
			status: 'completed' as const,
			conclusion: 'success',
		})),
		...passedBuild,
		{ name: 'npm', status: 'in_progress', conclusion: null },
	];
	await world.wait(48_000);
	expect(run.status).toBe('in_progress');
	expect(crateRuns()).toHaveLength(1);
	const crates = one((await executions()).filter(entry => entry.operation === 'crates'), 'crates execution');
	expect([crates.state, crates.version, crates.sourceSha, crates.dependencies]).toEqual([
		'dispatching',
		'1.0.0',
		run.headSha,
		[],
	]);
	run.jobs = run.jobs.map(job => job.name === 'npm' ? { ...job, status: 'completed', conclusion: 'failure' } : job);
	run.status = 'completed';
	run.conclusion = 'failure';
	await notify('completed');
	await world.wait(16_000);
	expect(crateRuns()).toHaveLength(1);
	expect((await executions()).map(entry => [entry.operation, entry.state]).sort()).toEqual([
		['crates', 'running'],
		['release', 'failed'],
	]);
}, 60_000);

test('the crates never start when a build job fails', async () => {
	const { run, notify, crateRuns, executions } = await stagedRelease();
	run.jobs = [
		{ name: 'Plan release', status: 'completed', conclusion: 'success' },
		{ name: 'linux', status: 'completed', conclusion: 'success' },
		{ name: 'macos', status: 'completed', conclusion: 'failure' },
		{ name: 'Assemble payload', status: 'completed', conclusion: 'skipped' },
		{ name: 'github', status: 'completed', conclusion: 'skipped' },
	];
	await world.wait(48_000);
	expect(crateRuns()).toEqual([]);
	run.status = 'completed';
	run.conclusion = 'failure';
	await notify('completed');
	await world.wait(16_000);
	expect(crateRuns()).toEqual([]);
	expect((await executions()).map(entry => [entry.operation, entry.state])).toEqual([['release', 'failed']]);
}, 60_000);

test('a completed run starts the crates when its build jobs passed, after tracking gave up', async () => {
	const { repository, run, notify, crateRuns, executions } = await stagedRelease();
	const storage = world.coordinators.instance(String(repository.id)).storage;
	world.network.serve('api.github.com', request => {
		if (new URL(request.url).pathname.endsWith('/jobs')) throw new TypeError('Connection reset by peer');
		return world.github.handle(request);
	});
	run.jobs = [...passedBuild, { name: 'npm', status: 'in_progress', conclusion: null }];
	await world.wait(30_000 * 11);
	expect([...storage.snapshot()].filter(([key]) => key.startsWith('track:'))).toEqual([]);
	const dead = await world.db.prepare('SELECT target FROM audit WHERE action=?').bind('track.dead').all();
	expect(z.array(z.object({ target: z.string() })).parse(dead.results).map(row => row.target)).toEqual([
		expect.stringMatching(/^run 9200 after 10 attempts: GitHub unreachable on GET .*\/jobs/),
	]);
	expect(crateRuns()).toEqual([]);
	world.network.serve('api.github.com', request => world.github.handle(request));
	run.jobs = [...passedBuild, { name: 'npm', status: 'completed', conclusion: 'failure' }];
	run.status = 'completed';
	run.conclusion = 'failure';
	await notify('completed');
	await world.wait(32_000);
	expect(crateRuns()).toHaveLength(1);
	expect((await executions()).map(entry => [entry.operation, entry.state]).sort()).toEqual([
		['crates', 'running'],
		['release', 'failed'],
	]);
}, 60_000);

for (const scenario of ['observed', 'unobserved', 'renamed'] as const) {
	test(
		scenario === 'observed'
			? 'crates missing from an earlier tagged release publish from the tagged commit after setup'
			: scenario === 'unobserved'
			? 'without a run of the tagged release, the missing crates need a new version'
			: 'crates that the tagged commit does not contain need a new version',
		async () => {
			const observed = scenario === 'observed';
			unpublished();
			const repository = lintRepository(stagedWorkflow);
			world.npm.publish('@octo/lint', '1.0.0');
			if (scenario === 'renamed') {
				world.github.push(repository, {
					'crates/core/Cargo.toml': '[package]\nname = "lint-engine"\nversion.workspace = true\n',
					'crates/cli/Cargo.toml':
						'[package]\nname = "lint"\nversion.workspace = true\n\n[dependencies]\nlint-engine = { path = "../core", version = "1.0.0" }\n',
				}, 'Name the engine crate');
			}
			const tagged = world.github.head(repository);
			repository.refs.set('tags/lint-v1.0.0', tagged);
			const earlier: Repository['runs'][number] = {
				id: 9100,
				path: '.github/workflows/release.yml',
				event: 'push',
				headSha: tagged,
				headBranch: 'lint-v1.0.0',
				status: 'completed',
				conclusion: 'failure',
				attempt: 1,
				title: 'Release',
				inputs: {},
				jobs: [...passedBuild, { name: 'npm', status: 'completed', conclusion: 'failure' }],
			};
			if (scenario !== 'unobserved') repository.runs.push(earlier);
			world.github.push(repository, {
				'README.md': '# Lint\n',
				...(scenario === 'renamed'
					? {
						'crates/core/Cargo.toml': '[package]\nname = "lint-core"\nversion.workspace = true\n',
						'crates/cli/Cargo.toml':
							'[package]\nname = "lint"\nversion.workspace = true\n\n[dependencies]\nlint-core = { path = "../core", version = "1.0.0" }\n',
					}
					: {}),
			}, 'Document the tool');
			const api = bearer(world, await world.cliSession());
			const plan = await discoverSetup(api, repository.name);
			expect(plan.blockers).toEqual([]);
			const applied = await applySetup(api, repository.name, plan, plan.choices);
			expect(applied.status).toBe(200);
			const merged = world.github.merge(repository, 1);
			passChecks(repository, merged.sha);
			const discovered = z.object({ findings: z.array(z.looseObject({ message: z.string() })) }).parse(
				(await api('/api/repositories/discover', { repository: repository.name })).body,
			);
			const stranded = `Version tag lint-v1.0.0 already targets ${tagged.slice(0, 12)}, so ${
				observed ? '' : 'pkg:cargo/lint, pkg:cargo/lint-core, '
			}pkg:golang/github.com/octo/lint/go, pkg:pypi/lint-py cannot publish 1.0.0. Release a new version.`;
			expect(discovered.findings.map(finding => finding.message)).toEqual([
				observed
					? `pkg:cargo/lint, pkg:cargo/lint-core 1.0.0 publish from lint-v1.0.0 after release.yml run 9100. ${stranded}`
					: stranded,
			]);
			await world.wait(16_000);
			const listed = await executions(api);
			expect(listed.filter(entry => entry.operation === 'promote')).toEqual([]);
			if (!observed) {
				expect(listed).toEqual([]);
				return;
			}
			const crates = one(listed.filter(entry => entry.operation === 'crates'), 'crates execution');
			expect([crates.version, crates.sourceSha, crates.dependencies]).toEqual(['1.0.0', tagged, []]);
			const dispatched = one(
				repository.runs.filter(entry => entry.path === '.github/workflows/publish-crates.yml'),
				'crates run',
			);
			const begun = await begin(
				world,
				runIdentity(repository, dispatched, 'publish-crates.yml'),
				crates.id,
				'lint',
				'crates',
			);
			expect(JSON.parse(begun.outputs.context ?? '{}')).toMatchObject({ sourceSha: tagged, version: '1.0.0' });
			expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
			expect((await executions(api)).filter(entry => entry.operation === 'crates')).toHaveLength(1);
		},
		60_000,
	);
}

for (const rewritten of [false, true]) {
	test(
		rewritten
			? 'the crates refuse when the default branch no longer contains the tagged commit'
			: 'the crates publish the tagged commit after the default branch moves on',
		async () => {
			const { repository, run, crateRuns, executions } = await stagedRelease();
			const branch = repository.defaultBranch;
			if (rewritten) {
				const parent = repository.commits.get(run.headSha)?.parents[0];
				if (!parent) throw new Error('The tagged commit has no parent');
				repository.refs.set('heads/rewrite', parent);
				const replaced = world.github.push(repository, { 'README.md': '# Rewritten\n' }, 'Rewrite history', 'rewrite');
				repository.refs.set(`heads/${branch}`, replaced.sha);
			} else {
				world.github.push(repository, { 'README.md': '# Moved on\n' }, 'Merge a dependency update');
			}
			expect(world.github.head(repository)).not.toBe(run.headSha);
			run.jobs = [...passedBuild, { name: 'npm', status: 'in_progress', conclusion: null }];
			await world.wait(48_000);
			const crates = one((await executions()).filter(entry => entry.operation === 'crates'), 'crates execution');
			expect(crates.sourceSha).toBe(run.headSha);
			if (rewritten) {
				expect(crateRuns()).toEqual([]);
				expect([crates.state, crates.reason]).toEqual([
					'failed',
					`${branch} at ${world.github.head(repository).slice(0, 12)} no longer contains ${run.headSha.slice(0, 12)}`,
				]);
			} else {
				const dispatched = one(crateRuns(), 'crates run');
				expect(dispatched.headSha).toBe(world.github.head(repository));
				const begun = await begin(
					world,
					runIdentity(repository, dispatched, 'publish-crates.yml'),
					crates.id,
					'lint',
					'crates',
				);
				expect(JSON.parse(begun.outputs.context ?? '{}')).toMatchObject({ sourceSha: run.headSha });
				expect(one((await executions()).filter(entry => entry.operation === 'crates'), 'crates execution').state)
					.toBe('running');
			}
		},
		60_000,
	);
}
