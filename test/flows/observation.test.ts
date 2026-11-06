import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { type Repository, ownerId } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

function workflow(on: string, run: string): string {
	return `name: Release\non: ${on}\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}

async function adopt(repository: Repository) {
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	expect(plan.blockers).toEqual([]);
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(200);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const reopened = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	return { plan, reopened };
}

async function observe(repository: Repository, event: string, branch: string): Promise<Execution[]> {
	const run = {
		id: 9000 + repository.runs.length,
		path: '.github/workflows/release.yml',
		event,
		headSha: world.github.head(repository),
		headBranch: branch,
		status: 'completed' as const,
		conclusion: 'success',
		attempt: 1,
		title: 'Release',
		inputs: {},
	};
	repository.runs.push(run);
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: { id: run.id, conclusion: 'success', event, path: run.path, head_repository: { id: repository.id } },
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	return journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value));
}

test('an adopted prefixed tag family is observed with its version and publication', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const { plan, reopened } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/tags/widget-v*', publications: ['pkg:npm/widget'] },
	]);
	expect(reopened.choices.streams[0]?.observe).toEqual(plan.choices.streams[0]?.observe);
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [execution, ...rest] = await observe(repository, 'push', 'widget-v1.2.0');
	expect(rest).toEqual([]);
	expect(execution?.version).toBe('1.2.0');
	expect(execution?.publications.map(publication => [publication.id, publication.outcome])).toEqual([
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('a manually dispatched release takes its version from the manifest', async () => {
	const repository = world.github.create('octo/cli', {
		'package.json': JSON.stringify({ name: 'cli', version: '2.0.0' }),
		'.github/workflows/release.yml': workflow('{ workflow_dispatch: {} }', 'npm publish'),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', publications: ['pkg:npm/cli'] },
	]);
	world.npm.publish('cli', '2.0.0');
	const [dispatched] = await observe(repository, 'workflow_dispatch', 'main');
	expect(dispatched?.version).toBeUndefined();
	expect(dispatched?.publications.map(publication => [publication.id, publication.version, publication.outcome]))
		.toEqual([['pkg:npm/cli', '2.0.0', 'succeeded']]);
	const executions = await observe(repository, 'workflow_run', 'main');
	expect(executions).toHaveLength(2);
	expect(executions.find(execution => execution.id !== dispatched?.id)?.publications).toEqual([]);
});

test('a tag prefix with a directory is proposed, applied and restored', async () => {
	const repository = world.github.create('octo/tools', {
		'Cargo.toml': '[package]\nname = "tools"\nversion = "0.1.0"\npublish = false\n',
		'.github/workflows/release.yml': workflow(
			"{ push: { tags: 'tools/v*' } }",
			'gh release create "$GITHUB_REF_NAME" plugin.wasm',
		),
	});
	const { plan, reopened } = await adopt(repository);
	expect(plan.choices.streams[0]?.versionSource).toEqual({ kind: 'tags', prefix: 'tools/v' });
	expect(plan.choices.streams[0]?.observe?.[0]?.ref).toBe('refs/tags/tools/v*');
	expect(reopened.choices.streams).toEqual(plan.choices.streams);
	expect(reopened.blockers).toEqual([]);
	repository.refs.set('tags/tools/v0.2.0', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'tools/v0.2.0');
	expect(execution?.version).toBe('0.2.0');
});

test('a publisher on a non-default branch is observed on that branch', async () => {
	const repository = world.github.create('octo/snapshots', {
		'package.json': JSON.stringify({ name: 'snapshots', version: '1.0.0' }),
		'.github/workflows/release.yml': workflow('{ push: { branches: [release] } }', 'npm publish --tag next'),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/heads/release', publications: [] },
	]);
	const [execution] = await observe(repository, 'push', 'release');
	expect(execution?.stream).toBe(plan.choices.streams[0]?.name);
	expect(execution?.publications).toEqual([]);
});

test('editing an adopted stream clears publications and leaves observation', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const { reopened } = await adopt(repository);
	const api = bearer(world, await world.cliSession());
	const stored = async () =>
		z.object({
			streams: z.record(
				z.string(),
				z.object({ workflows: z.record(z.string(), z.object({ mode: z.string() }).loose()).optional() }).loose(),
			),
		}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	const apply = async (choices: SetupChoices) => {
		const preview = await Effect.runPromise(
			parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
		);
		expect(preview.blockers).toEqual([]);
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices,
			planId: preview.planId,
			sourceSha: preview.sourceSha,
			setupHead: preview.setupHead,
		});
		expect(applied.status).toBe(200);
	};
	const [stream] = reopened.choices.streams;
	if (!stream?.observe) throw new Error('Expected an observed stream');
	await apply({
		streams: [{
			...stream,
			packages: [],
			required: [],
			observe: stream.observe.map(binding => ({ ...binding, publications: [] })),
		}],
	});
	expect((await stored()).streams[stream.name]?.workflows?.release).toEqual({
		file: 'release.yml',
		mode: 'observe',
		ref: 'refs/tags/widget-v*',
		publications: [],
	});
	const { observe: _observe, versionSource: _versionSource, ...managed } = stream;
	await apply({
		streams: [{
			...managed,
			prepare: {
				file: 'prepare.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'npm install',
				publicationSteps: {},
			},
			promote: {
				file: 'publish.yml',
				job: 'promote',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
			},
		}],
	});
	const workflows = (await stored()).streams[stream.name]?.workflows ?? {};
	expect(Object.values(workflows).filter(binding => binding.mode === 'observe')).toEqual([]);
});

test('every tag family of a workflow is observed', async () => {
	const repository = world.github.create('octo/families', {
		'package.json': JSON.stringify({ name: 'families', version: '1.0.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['foo-v*', 'bar-v*'] } }", 'npm publish'),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.ref)).toEqual([
		'refs/tags/foo-v*',
		'refs/tags/bar-v*',
	]);
	world.npm.publish('families', '1.0.0');
	repository.refs.set('tags/bar-v1.0.0', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'bar-v1.0.0');
	expect(execution?.version).toBe('1.0.0');
	expect(execution?.publications.map(publication => publication.outcome)).toEqual(['succeeded']);
});

test('a workflow filename with dots is adopted', async () => {
	const repository = world.github.create('octo/dotted', {
		'Cargo.toml': '[package]\nname = "dotted"\nversion = "0.1.0"\npublish = false\n',
		'.github/workflows/release.plugin.yml': workflow(
			"{ push: { tags: ['v*'] } }",
			'gh release create "$GITHUB_REF_NAME" plugin.wasm',
		),
	});
	const { plan, reopened } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.file)).toEqual(['release.plugin.yml']);
	expect(reopened.choices.streams).toEqual(plan.choices.streams);
});

test('an observed run records only the publications its binding lists', async () => {
	const repository = world.github.create('octo/pair', {
		'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
		'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
		'.github/workflows/release.yml': workflow('{ workflow_dispatch: {} }', 'cd packages/a && npm publish'),
	});
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const choices: SetupChoices = {
		streams: [{
			name: 'pair',
			packages: ['pkg:npm/a', 'pkg:npm/b'],
			required: ['pkg:npm/a', 'pkg:npm/b'],
			versioning: 'independent',
			observe: [{ name: 'release', file: 'release.yml', publications: ['pkg:npm/a'] }],
		}],
	};
	const preview = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(preview.blockers).toEqual([]);
	expect(
		(await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices,
			planId: preview.planId,
			sourceSha: preview.sourceSha,
			setupHead: preview.setupHead,
		})).status,
	).toBe(200);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	world.npm.publish('a', '1.0.0');
	const [execution] = await observe(repository, 'workflow_dispatch', 'main');
	expect(execution?.publications.map(publication => [publication.id, publication.required, publication.outcome]))
		.toEqual([['pkg:npm/a', true, 'succeeded']]);
	expect(execution?.state).toBe('succeeded');
});
