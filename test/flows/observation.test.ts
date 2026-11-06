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

async function observe(
	repository: Repository,
	event: string,
	branch: string,
	path = '.github/workflows/release.yml',
): Promise<Execution[]> {
	const run = {
		id: 9000 + repository.runs.length,
		path,
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
	const triggered = executions.find(execution => execution.id !== dispatched?.id);
	expect(triggered?.publications.map(publication => [publication.id, publication.version, publication.outcome]))
		.toEqual([['pkg:npm/cli', '2.0.0', 'succeeded']]);
	expect(triggered?.state).toBe('succeeded');
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

test('a dispatch at a prefixed tag is observed as that release', async () => {
	const repository = world.github.create('octo/tools', {
		'Cargo.toml': '[package]\nname = "tools"\nversion = "0.1.0"\npublish = false\n',
		'.github/workflows/release.yml': workflow(
			"{ push: { tags: 'tools/v*' }, workflow_dispatch: {} }",
			'gh release create "$GITHUB_REF_NAME" plugin.wasm',
		),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.ref)).toContain('refs/tags/tools/v*');
	repository.refs.set('tags/tools/v0.2.0', world.github.head(repository));
	const executions = await observe(repository, 'workflow_dispatch', 'tools/v0.2.0');
	expect(executions.map(execution => execution.version)).toEqual(['0.2.0']);
});

test('reopening setup keeps the implicit coverage of an observe binding', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const { plan } = await adopt(repository);
	const [stream] = plan.choices.streams;
	if (!stream) throw new Error('Expected an adopted stream');
	const path = ['.github', 'beepboop.json'].join('/');
	const stored = z.object({
		streams: z.record(
			z.string(),
			z.object({ workflows: z.record(z.string(), z.record(z.string(), z.unknown())) }).loose(),
		),
	}).loose().parse(JSON.parse(world.github.file(repository, path) ?? '{}'));
	const current = stored.streams[stream.name];
	if (!current) throw new Error('Expected the stored stream');
	const { packages: _packages, ...rest } = current;
	const workflows = Object.fromEntries(
		Object.entries(current.workflows).map(([name, { publications: _publications, ...binding }]) => [name, binding]),
	);
	world.github.push(
		repository,
		{ [path]: JSON.stringify({ ...stored, streams: { ...stored.streams, [stream.name]: { ...rest, workflows } } }) },
		'Drop explicit coverage',
	);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const reopened = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	expect(reopened.choices.streams[0]?.packages).toEqual(['pkg:npm/widget']);
	expect(reopened.choices.streams[0]?.observe?.map(binding => binding.publications)).toEqual([['pkg:npm/widget']]);
});

test('a manual dispatch of a branch publisher verifies its publications', async () => {
	const repository = world.github.create('octo/branch', {
		'package.json': JSON.stringify({ name: 'branch', version: '3.0.0' }),
		'.github/workflows/release.yml': workflow('{ push: { branches: [main] }, workflow_dispatch: {} }', 'npm publish'),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/heads/main', publications: ['pkg:npm/branch'] },
	]);
	world.npm.publish('branch', '3.0.0');
	const [execution] = await observe(repository, 'workflow_dispatch', 'main');
	expect(execution?.publications.map(publication => [publication.id, publication.version, publication.outcome]))
		.toEqual([['pkg:npm/branch', '3.0.0', 'succeeded']]);
	const pushed = (await observe(repository, 'push', 'main')).find(candidate => candidate.id !== execution?.id);
	expect(pushed?.publications.map(publication => [publication.id, publication.version, publication.outcome]))
		.toEqual([['pkg:npm/branch', '3.0.0', 'succeeded']]);
	expect(pushed?.state).toBe('succeeded');
});

test('setup accepts the shorthand refs that configuration accepts', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const { reopened } = await adopt(repository);
	const [stream] = reopened.choices.streams;
	if (!stream?.observe) throw new Error('Expected an observed stream');
	const choices: SetupChoices = {
		streams: [{ ...stream, observe: stream.observe.map(binding => ({ ...binding, ref: 'widget-v*' })) }],
	};
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	expect(preview.status).toBe(200);
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.ref)).toEqual(['widget-v*']);
});

async function pin(
	repository: Repository,
	plan: { choices: SetupChoices },
	ref: string,
): Promise<void> {
	const [stream] = plan.choices.streams;
	if (!stream) throw new Error('Expected an adopted stream');
	const path = ['.github', 'beepboop.json'].join('/');
	const stored = z.object({
		streams: z.record(
			z.string(),
			z.object({ workflows: z.record(z.string(), z.record(z.string(), z.unknown())) }).loose(),
		),
	}).loose().parse(JSON.parse(world.github.file(repository, path) ?? '{}'));
	const current = stored.streams[stream.name];
	if (!current) throw new Error('Expected the stored stream');
	const workflows = Object.fromEntries(
		Object.entries(current.workflows).map(([name, binding]) => [name, { ...binding, ref }]),
	);
	world.github.push(
		repository,
		{ [path]: JSON.stringify({ ...stored, streams: { ...stored.streams, [stream.name]: { ...current, workflows } } }) },
		'Pin the release tag',
	);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
}

test('an observe binding on an exact tag keeps the tag version', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const { plan } = await adopt(repository);
	await pin(repository, plan, 'refs/tags/widget-v1.2.0');
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'widget-v1.2.0');
	expect(execution?.version).toBe('1.2.0');
	expect(execution?.publications.map(publication => [publication.id, publication.outcome])).toEqual([
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('an observe binding on a numbered tag glob keeps every version component', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.3' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'npm publish'),
	});
	const { plan } = await adopt(repository);
	await pin(repository, plan, 'refs/tags/v1.*');
	world.npm.publish('widget', '1.2.3');
	repository.refs.set('tags/v1.2.3', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'v1.2.3');
	expect(execution?.version).toBe('1.2.3');
	expect(execution?.state).toBe('succeeded');
});

async function complete(
	repository: Repository,
	run: { id: number; event: string; branch: string; conclusion: string; attempt: number; path?: string },
): Promise<Execution[]> {
	const path = run.path ?? '.github/workflows/release.yml';
	const existing = repository.runs.find(entry => entry.id === run.id);
	if (existing) {
		existing.conclusion = run.conclusion;
		existing.attempt = run.attempt;
	} else {
		repository.runs.push({
			id: run.id,
			path,
			event: run.event,
			headSha: world.github.head(repository),
			headBranch: run.branch,
			status: 'completed',
			conclusion: run.conclusion,
			attempt: run.attempt,
			title: 'Release',
			inputs: {},
		});
	}
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: run.id,
			conclusion: run.conclusion,
			event: run.event,
			path,
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	return journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value));
}

test('a re-run attempt records its own outcome', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	await adopt(repository);
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [first] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'failure',
		attempt: 1,
	});
	expect(first?.state).toBe('failed');
	world.npm.publish('widget', '1.2.0');
	const after = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'success',
		attempt: 2,
	});
	expect(after.map(execution => [execution.runAttempt, execution.state])).toEqual([[2, 'succeeded']]);
});

test('a run without its tag fails once and an unreadable run stops being retried', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	await adopt(repository);
	const [execution] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'success',
		attempt: 1,
	});
	expect(execution?.state).toBe('failed');
	expect(execution?.reason).toBe('Release tag widget-v1.2.0 was not found');
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: 9999,
			conclusion: 'success',
			event: 'push',
			path: '.github/workflows/release.yml',
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	await world.wait(12 * 60_000, 2_000);
	const journal = await world.coordinator(repository).exportJournal();
	expect(journal.filter(entry => entry.key.startsWith('observe:'))).toEqual([]);
});

test('a tag ahead of the manifest fails the observed release', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	await adopt(repository);
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.3.0', world.github.head(repository));
	const [execution] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.3.0',
		conclusion: 'success',
		attempt: 1,
	});
	expect(execution?.state).toBe('failed');
	expect(execution?.reason).toBe('Tag widget-v1.3.0 names version 1.3.0, but widget carries 1.2.0');
	expect(execution?.publications).toEqual([]);
});

test('an unsigned commit does not fail an observed release', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	await adopt(repository);
	const head = repository.commits.get(world.github.head(repository));
	if (!head) throw new Error('Expected the head commit');
	head.verified = false;
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [execution] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'success',
		attempt: 1,
	});
	expect(execution?.state).toBe('succeeded');
});

test('a workflow_run run on a prefixed tag matches its tag binding', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'echo build'),
		'.github/workflows/publish.yml': workflow(
			'{ workflow_run: { workflows: [Release], types: [completed] } }',
			'npm publish',
		),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/tags/widget-v*', publications: ['pkg:npm/widget'] },
	]);
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	await complete(repository, { id: 9001, event: 'push', branch: 'widget-v1.2.0', conclusion: 'success', attempt: 1 });
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			observe: [{ name: 'publish', file: 'publish.yml', ref: 'refs/tags/widget-v*', publications: ['pkg:npm/widget'] }],
		}],
	};
	const api = bearer(world, await world.cliSession());
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
	world.github.merge(repository, 2);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const executions = await complete(repository, {
		id: 9002,
		event: 'workflow_run',
		branch: 'widget-v1.2.0',
		conclusion: 'success',
		attempt: 1,
		path: '.github/workflows/publish.yml',
	});
	const followed = executions.find(execution => execution.runId === 9002);
	expect(followed?.operation).toBe('publish');
	expect(followed?.version).toBe('1.2.0');
	expect(followed?.publications.map(publication => [publication.id, publication.outcome])).toEqual([
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('a tag push on a workflow with tag and branch triggers is recorded once', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow(
			"{ push: { tags: ['widget-v*'], branches: [main, next] } }",
			'npm publish',
		),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.ref)).toEqual([
		'refs/tags/widget-v*',
		'refs/heads/*',
	]);
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const executions = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'success',
		attempt: 1,
	});
	expect(executions.map(execution => [execution.operation, execution.version])).toEqual([['release', '1.2.0']]);
});

test('reopening setup keeps an empty required set', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const suggested = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	const [stream] = suggested.choices.streams;
	if (!stream?.observe) throw new Error('Expected an observed stream');
	const choices: SetupChoices = { streams: [{ ...stream, required: [] }] };
	const plan = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name, choices })).body),
	);
	expect(plan.blockers).toEqual([]);
	expect(
		(await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		})).status,
	).toBe(200);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const reopened = await Effect.runPromise(
		parseSetupPlan((await api('/api/repositories/setup/preview', { repository: repository.name })).body),
	);
	expect(reopened.choices.streams[0]?.required).toEqual([]);
});

test('a run without a head branch is ignored', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow(
			"{ push: { tags: ['widget-v*'], branches: [main, next] } }",
			'npm publish',
		),
	});
	await adopt(repository);
	repository.runs.push({
		id: 9001,
		path: '.github/workflows/release.yml',
		event: 'push',
		headSha: world.github.head(repository),
		headBranch: null,
		status: 'completed',
		conclusion: 'success',
		attempt: 1,
		title: 'Release',
		inputs: {},
	});
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: 9001,
			conclusion: 'success',
			event: 'push',
			path: '.github/workflows/release.yml',
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	expect(journal.filter(entry => entry.key.startsWith('execution:') || entry.key.startsWith('observe:'))).toEqual([]);
});

test("a tag glob on one workflow does not reclassify another workflow's branch runs", async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow('{ release: { types: [published] } }', 'npm publish'),
		'.github/workflows/snapshot.yml': workflow('{ push: { branches: [main] } }', 'npm publish --tag next'),
	});
	const { plan } = await adopt(repository);
	expect(plan.choices.streams.flatMap(stream => stream.observe?.map(binding => binding.ref) ?? []).sort()).toEqual([
		'refs/heads/main',
		'refs/tags/*',
	]);
	const [execution] = await observe(repository, 'push', 'main', '.github/workflows/snapshot.yml');
	expect(execution?.operation).toBe('snapshot');
	expect(execution?.state).toBe('succeeded');
	expect(execution?.version).toBeUndefined();
});

test('a transient tag lookup failure is retried instead of failing the release', async () => {
	const repository = world.github.create('octo/widget', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
		'.github/workflows/release.yml': workflow("{ push: { tags: ['widget-v*'] } }", 'npm publish'),
	});
	await adopt(repository);
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	let failing = true;
	world.network.serve('api.github.com', request =>
		failing && request.url.includes('/git/ref/tags/widget-v1.2.0')
			? Response.json({ message: 'Unicorn' }, { status: 503 })
			: world.github.handle(request));
	const first = await observe(repository, 'push', 'widget-v1.2.0');
	expect(first).toEqual([]);
	failing = false;
	await world.wait(2 * 60_000, 2_000);
	const journal = await world.coordinator(repository).exportJournal();
	const executions = journal.filter(entry => entry.key.startsWith('execution:')).map(entry =>
		decodeExecutionV1(entry.value)
	);
	expect(executions.map(execution => [execution.version, execution.state])).toEqual([['1.2.0', 'succeeded']]);
	world.network.serve('api.github.com', request => world.github.handle(request));
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
