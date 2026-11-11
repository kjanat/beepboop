import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { bearer, field } from '@root/test/support/http.ts';
import { runWorkflow } from '@root/test/support/repositories.ts';
import { applyChoices, applySetup, discoverSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import { runFailedNote } from '@/automation/execution';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

let world: World;
eachWorld(created => {
	world = created;
});

function workflow(on: string, run: string): string {
	return `name: Release\n${runWorkflow(on, run)}`;
}

function npmRelease(name: string, version: string, on: string, run = 'npm publish'): Repository {
	return world.github.create(`octo/${name}`, {
		'package.json': JSON.stringify({ name, version }),
		'.github/workflows/release.yml': workflow(on, run),
	});
}

async function adopt(repository: Repository) {
	const api = bearer(world, await world.cliSession());
	const plan = await discoverSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	const applied = await applySetup(api, repository.name, plan, plan.choices);
	expect(applied.status).toBe(200);
	world.github.merge(repository, 1);
	const reopened = await discoverSetup(api, repository.name);
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
	await world.workflowRun(repository, run, 'success', event);
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	return journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value));
}

test('an adopted prefixed tag family is observed with its version and publication', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	const repository = npmRelease('cli', '2.0.0', '{ workflow_dispatch: {} }');
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

test('a workflow with tag and dispatch triggers is observed once, on its tags', async () => {
	const repository = npmRelease(
		'widget',
		'1.2.0',
		"{ push: { tags: ['widget-v*'] }, workflow_dispatch: { inputs: { registry: { type: string } } } }",
	);
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/tags/widget-v*', publications: ['pkg:npm/widget'] },
	]);
});

test('reopening setup keeps the implicit coverage of an observe binding', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	const reopened = await discoverSetup(api, repository.name);
	expect(reopened.choices.streams[0]?.packages).toEqual(['pkg:npm/widget']);
	expect(reopened.choices.streams[0]?.observe?.map(binding => binding.publications)).toEqual([['pkg:npm/widget']]);
});

test('a manual dispatch of a branch publisher verifies its publications', async () => {
	const repository = npmRelease('branch', '3.0.0', '{ push: { branches: [main] }, workflow_dispatch: {} }');
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
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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

test('an observe binding on a shorthand tag glob keeps the tag version', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	const { plan } = await adopt(repository);
	await pin(repository, plan, 'widget-v*');
	world.npm.publish('widget', '1.2.0');
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'widget-v1.2.0');
	expect(execution?.version).toBe('1.2.0');
	expect(execution?.publications.map(publication => [publication.id, publication.outcome])).toEqual([
		['pkg:npm/widget', 'succeeded'],
	]);
});

test('an observe binding on a numbered tag glob keeps every version component', async () => {
	const repository = npmRelease('widget', '1.2.3', "{ push: { tags: ['v*'] } }");
	const { plan } = await adopt(repository);
	await pin(repository, plan, 'refs/tags/v1.*');
	world.npm.publish('widget', '1.2.3');
	repository.refs.set('tags/v1.2.3', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'v1.2.3');
	expect(execution?.version).toBe('1.2.3');
	expect(execution?.state).toBe('succeeded');
});

test('a placeholder manifest version is verified at the release version', async () => {
	const repository = npmRelease('widget', '0.0.0', "{ push: { tags: ['v*'] } }");
	await adopt(repository);
	world.npm.publish('widget', '1.2.3');
	repository.refs.set('tags/v1.2.3', world.github.head(repository));
	const [execution] = await observe(repository, 'push', 'v1.2.3');
	expect(execution?.version).toBe('1.2.3');
	expect(execution?.state).toBe('succeeded');
	expect(execution?.publications.map(publication => [publication.id, publication.version, publication.outcome]))
		.toEqual([['pkg:npm/widget', '1.2.3', 'succeeded']]);
});

async function complete(
	repository: Repository,
	run: { id: number; event: string; branch: string; conclusion: string; attempt: number; path?: string },
): Promise<Execution[]> {
	const path = run.path ?? '.github/workflows/release.yml';
	const existing = repository.runs.find(entry => entry.id === run.id);
	if (existing) {
		existing.status = 'completed';
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
	await world.workflowRun(repository, { id: run.id, path }, run.conclusion, run.event);
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	return journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value));
}

test('a re-run attempt records its own outcome', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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

test('a failed run counts as succeeded once every required publication is on the registry', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	await adopt(repository);
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const failure = { id: 9001, event: 'push', branch: 'widget-v1.2.0', conclusion: 'failure', attempt: 1 };
	const [first] = await complete(repository, failure);
	expect([first?.state, first?.reason]).toEqual(['failed', undefined]);
	world.npm.publish('widget', '1.2.0');
	await world.coordinator(repository).recover(first?.id ?? '', 'reconcile', 'test');
	await world.wait(2_000);
	const journal = await world.coordinator(repository).exportJournal();
	const late = journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value));
	expect(late.map(execution => [execution.state, execution.reason])).toEqual([['succeeded', runFailedNote]]);
});

test('a run that fails after publishing every required package counts as succeeded', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	await adopt(repository);
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	world.npm.publish('widget', '1.2.0');
	const [published] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'failure',
		attempt: 1,
	});
	expect([published?.state, published?.reason]).toEqual(['succeeded', runFailedNote]);
	expect(published?.publications.map(publication => publication.outcome)).toEqual(['succeeded']);
});

test('retrying a failed observed tag release by its short ID re-runs the failed jobs', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	await adopt(repository);
	repository.refs.set('tags/widget-v1.2.0', world.github.head(repository));
	const [failed] = await complete(repository, {
		id: 9001,
		event: 'push',
		branch: 'widget-v1.2.0',
		conclusion: 'failure',
		attempt: 1,
	});
	if (!failed) throw new Error('Expected the failed release');
	const api = bearer(world, await world.cliSession());
	const retried = await api('/api/executions/recover', { id: failed.id.slice(0, 12), action: 'retry' });
	expect([retried.status, field(retried.body, 'id'), field(retried.body, 'state')]).toEqual([
		200,
		failed.id,
		'uncertain',
	]);
	expect(repository.runs.find(run => run.id === 9001)?.attempt).toBe(2);
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

async function failedTagRelease(conclusion: string, tag: string, ref?: string) {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	const { plan } = await adopt(repository);
	if (ref !== undefined) await pin(repository, plan, ref);
	repository.refs.set(`tags/${tag}`, world.github.head(repository));
	const [failed] = await complete(repository, { id: 9001, event: 'push', branch: tag, conclusion, attempt: 1 });
	if (failed?.state !== 'failed') throw new Error('Expected the failed release');
	const api = bearer(world, await world.cliSession());
	const retry = () => api('/api/executions/recover', { id: failed.id, action: 'retry' });
	return { repository, failed, retry };
}

test('a retry refuses an observed release whose tag moved to a later commit', async () => {
	const { repository, failed, retry } = await failedTagRelease('failure', 'widget-v1.2.0');
	const later = world.github.push(repository, { 'README.md': '# widget\n' }, 'Document widget');
	repository.refs.set('tags/widget-v1.2.0', later.sha);
	const refused = await retry();
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		`Tag widget-v1.2.0 moved to ${later.sha.slice(0, 12)}; this release builds ${failed.sourceSha.slice(0, 12)}`,
	]);
	expect(repository.runs.find(run => run.id === 9001)?.attempt).toBe(1);
});

test('a retry refuses a moved tag of a shorthand tag pattern', async () => {
	const { repository, failed, retry } = await failedTagRelease('failure', 'widget-v1.2.0', 'widget-v*');
	const later = world.github.push(repository, { 'README.md': '# widget\n' }, 'Document widget');
	repository.refs.set('tags/widget-v1.2.0', later.sha);
	const refused = await retry();
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		`Tag widget-v1.2.0 moved to ${later.sha.slice(0, 12)}; this release builds ${failed.sourceSha.slice(0, 12)}`,
	]);
	expect(repository.runs.find(run => run.id === 9001)?.attempt).toBe(1);
});

test('a retry refuses an observed release whose tag was deleted while a branch has its name', async () => {
	const { repository, retry } = await failedTagRelease('failure', 'widget-v1.2.0');
	repository.refs.set('heads/widget-v1.2.0', world.github.head(repository));
	repository.refs.delete('tags/widget-v1.2.0');
	const refused = await retry();
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		'Workflow ref widget-v1.2.0 no longer exists',
	]);
	expect(repository.runs.find(run => run.id === 9001)?.attempt).toBe(1);
});

test('a retry refuses an observed release whose run succeeded', async () => {
	const { repository, retry } = await failedTagRelease('success', 'widget-v1.3.0');
	const refused = await retry();
	expect([refused.status, field(refused.body, 'error')]).toEqual([
		422,
		'Workflow run 9001 succeeded, so it has no failed jobs to re-run. Fix the reported problem and re-run the workflow on GitHub',
	]);
	expect(repository.runs.find(run => run.id === 9001)?.attempt).toBe(1);
});

test('a short ID that matches no operation is unknown', async () => {
	const api = bearer(world, await world.cliSession());
	const missing = await api('/api/executions/recover', { id: 'abcdef012345', action: 'retry' });
	expect(missing.status).toBe(404);
});

test('a run without its tag fails once and an unreadable run stops being retried', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	await world.workflowRun(repository, { id: 9999, path: '.github/workflows/release.yml' }, 'success', 'push');
	await world.wait(2_000);
	await world.wait(12 * 60_000, 2_000);
	const journal = await world.coordinator(repository).exportJournal();
	expect(journal.filter(entry => entry.key.startsWith('observe:'))).toEqual([]);
});

test('a tag ahead of the manifest fails the observed release', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
		{ name: 'release', file: 'release.yml', ref: 'refs/tags/widget-v*', publications: [] },
		{ name: 'publish', file: 'publish.yml', ref: 'refs/tags/widget-v*', publications: ['pkg:npm/widget'] },
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
	await applyChoices(api, repository.name, choices);
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
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'], branches: [main, next] } }");
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

test('a branch push is not classified as a tag by a tag glob', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['*'], branches: [main] } }");
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe?.map(binding => binding.ref)).toContain('refs/tags/*');
	world.npm.publish('widget', '1.2.0');
	const executions = await observe(repository, 'push', 'main');
	expect(executions.map(execution => [execution.state, execution.reason])).toEqual([['succeeded', undefined]]);
});

test('reopening setup keeps an empty required set', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	const api = bearer(world, await world.cliSession());
	const suggested = await discoverSetup(api, repository.name);
	const [stream] = suggested.choices.streams;
	if (!stream?.observe) throw new Error('Expected an observed stream');
	const choices: SetupChoices = { streams: [{ ...stream, required: [] }] };
	await applyChoices(api, repository.name, choices);
	world.github.merge(repository, 1);
	const reopened = await discoverSetup(api, repository.name);
	expect(reopened.choices.streams[0]?.required).toEqual([]);
});

test('a run without a head branch is ignored', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'], branches: [main, next] } }");
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
	await world.workflowRun(repository, { id: 9001, path: '.github/workflows/release.yml' }, 'success', 'push');
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
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
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
	const repository = npmRelease('snapshots', '1.0.0', '{ push: { branches: [release] } }', 'npm publish --tag next');
	const { plan } = await adopt(repository);
	expect(plan.choices.streams[0]?.observe).toEqual([
		{ name: 'release', file: 'release.yml', ref: 'refs/heads/release', publications: [] },
	]);
	const [execution] = await observe(repository, 'push', 'release');
	expect(execution?.stream).toBe(plan.choices.streams[0]?.name);
	expect(execution?.publications).toEqual([]);
});

test('editing an adopted stream clears publications and leaves observation', async () => {
	const repository = npmRelease('widget', '1.2.0', "{ push: { tags: ['widget-v*'] } }");
	const { reopened } = await adopt(repository);
	const api = bearer(world, await world.cliSession());
	const stored = async () =>
		z.object({
			streams: z.record(
				z.string(),
				z.object({ workflows: z.record(z.string(), z.object({ mode: z.string() }).loose()).optional() }).loose(),
			),
		}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/setup-update') ?? '{}'));
	const apply = async (choices: SetupChoices) => {
		await applyChoices(api, repository.name, choices);
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
	const repository = npmRelease('families', '1.0.0', "{ push: { tags: ['foo-v*', 'bar-v*'] } }");
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
	await applyChoices(api, repository.name, choices);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	world.npm.publish('a', '1.0.0');
	const [execution] = await observe(repository, 'workflow_dispatch', 'main');
	expect(execution?.publications.map(publication => [publication.id, publication.required, publication.outcome]))
		.toEqual([['pkg:npm/a', true, 'succeeded']]);
	expect(execution?.state).toBe('succeeded');
});
