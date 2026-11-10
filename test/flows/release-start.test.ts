import { expect, test } from 'bun:test';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId } from '@root/test/support/github.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer } from '@root/test/support/http.ts';
import { executions, promotions } from '@root/test/support/releases.ts';
import { editableConfiguration, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { z } from 'zod';
import type { Execution } from '@/automation/types';
import type { ReleaseStart, VersionBump } from '@/contract/release-start';

type Api = (path: string, body?: unknown) => Promise<Reply>;

let world: World;
eachWorld(created => {
	world = created;
});

const plan = z.looseObject({ sourceSha: z.string(), planId: z.string() });
const execution = z.looseObject({ id: z.string(), operation: z.string(), state: z.string() });

async function configured(start: ReleaseStart[], bump?: VersionBump, approval = 'required') {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main = {
		...configuration.streams.main,
		credentials: [],
		start,
		prepare: { strategy: 'managed', ...(bump ? { bump } : {}) },
		promote: { ...configuration.streams.main.promote, approval },
	};
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Configure release starts',
	);
	passChecks(repository, head.sha);
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: repository.name });
	expect(discovered.status).toBe(200);
	return { repository, api };
}

async function dashboard(path: string, body: unknown): Promise<Response> {
	return world.handle(
		new Request(`${origin}${path}`, {
			method: 'POST',
			headers: { Cookie: await world.adminCookie(), Origin: origin, 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);
}

async function release(send: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>, id: number) {
	const request = { repositoryId: id, stream: 'main', version: { bump: 'patch' } };
	const planned = await send('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId } = plan.parse(planned.body);
	const started = await send('/api/releases/prepare', { ...request, sourceSha, planId });
	expect(started.status).toBe(200);
	return execution.parse(started.body);
}

async function fromDashboard(path: string, body: unknown) {
	const response = await dashboard(path, body);
	return { status: response.status, body: await response.json() };
}

async function landed(repository: Repository) {
	await world.wait(16_000);
	const head = world.github.resolve(repository, repository.defaultBranch);
	passChecks(repository, head.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	return head;
}

async function publish(repository: Repository, promotion: Execution) {
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion.id);
	if (!run) throw new Error('The started release dispatched no run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, promotion.id, promotion.stream, 'promote');
	world.npm.publish('widget', '1.0.1');
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.1', outcome: 'succeeded' },
		]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(16_000);
}

async function publishedOnce(api: Api, repository: Repository, via: string) {
	const [promotion, ...more] = await promotions(api);
	expect(more).toEqual([]);
	expect(promotion).toMatchObject({ version: '1.0.1', approvedBy: 'start', started: { via } });
	if (!promotion) throw new Error('No promotion');
	expect(promotion.state).not.toBe('awaiting-approval');
	await publish(repository, promotion);
	expect((await promotions(api)).map(entry => [entry.version, entry.state])).toEqual([['1.0.1', 'succeeded']]);
}

test('a start from the CLI commits the bump as the bot and publishes once without another approval', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const before = world.github.head(repository);
	const started = await release(api, repository.id);
	expect(started).toMatchObject({ operation: 'prepare' });
	const head = await landed(repository);
	expect(head).toMatchObject({ parents: [before], message: 'chore(release): 1.0.1', verified: true, authorId: botId });
	expect(JSON.parse(world.github.file(repository, 'package.json') ?? '{}')).toHaveProperty('version', '1.0.1');
	expect(repository.pulls).toEqual([]);
	await publishedOnce(api, repository, 'cli');
});

test('a start from the dashboard opens the version PR, and its merge publishes without another approval', async () => {
	const { repository, api } = await configured([{ via: 'dashboard' }], 'pr');
	await release(fromDashboard, repository.id);
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	expect(pull.body).toContain(
		'Started from the dashboard. Merging this PR publishes the release, and nothing asks again.',
	);
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect((await promotions(api))[0]?.sourceSha).toBe(merged.sha);
	await publishedOnce(api, repository, 'dashboard');
});

test('the release action starts a release from its workflow_dispatch run and refuses any other run', async () => {
	const { repository, api } = await configured(
		[{ via: 'action', workflow: 'start-release.yml' }],
		'commit',
	);
	const sha = world.github.head(repository);
	const run = (file: string, event = 'workflow_dispatch') => ({ repository, runId: 77, sha, file, event });
	const refused = async (identity: ReturnType<typeof run>, reason: string) => {
		const response = await bearer(world, await world.runToken(identity))('/api/workflow/start', {
			stream: 'main',
			version: 'patch',
		});
		expect(response.status).toBe(403);
		expect(JSON.stringify(response.body)).toContain(reason);
	};
	await refused(run('other.yml'), 'other.yml cannot start releases of main');
	await refused(run('start-release.yml', 'push'), 'A release starts only from a workflow_dispatch run');
	const result = await runAction(world, 'start', run('start-release.yml'), {
		STREAM: 'main',
		RELEASE_VERSION: 'patch',
	});
	expect(execution.parse(JSON.parse(result.outputs.result ?? '{}'))).toMatchObject({ operation: 'prepare' });
	await landed(repository);
	await publishedOnce(api, repository, 'action');
});

test('a start through a channel the stream does not enable waits for approval like any other release', async () => {
	const { repository, api } = await configured([{ via: 'dashboard' }], 'commit');
	await release(api, repository.id);
	await landed(repository);
	const [promotion] = await promotions(api);
	expect(promotion).toMatchObject({ state: 'awaiting-approval' });
	expect(promotion).not.toHaveProperty('approvedBy');
	expect(promotion).not.toHaveProperty('started');
});

test('a protected default branch stops a commit bump with a reason and opens no PR', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	repository.protectedBranches.add(repository.defaultBranch);
	const before = world.github.head(repository);
	await release(api, repository.id);
	await world.wait(16_000);
	expect(world.github.head(repository)).toBe(before);
	expect(repository.pulls).toEqual([]);
	expect((await executions(api)).filter(entry => entry.operation === 'prepare')).toEqual([
		expect.objectContaining({
			state: 'failed',
			reason: expect.stringContaining('GitHub refused the version commit on main'),
		}),
	]);
	expect(await promotions(api)).toEqual([]);
});

test('failing checks on the bump commit stop a started release with a reason', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	await release(api, repository.id);
	await world.wait(16_000);
	const head = world.github.head(repository);
	repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toEqual([
		expect.objectContaining({ state: 'failed', reason: 'The release stopped: test failure', approvedBy: 'start' }),
	]);
	expect(repository.runs).toEqual([]);
});

test('missing package metadata stops a started release with a reason', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const head = world.github.push(repository, { 'README.md': null }, 'Remove the README');
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await release(api, repository.id);
	await landed(repository);
	expect(await promotions(api)).toEqual([
		expect.objectContaining({
			state: 'failed',
			reason: expect.stringContaining('Fix the package metadata before this release: '),
		}),
	]);
	expect(repository.runs).toEqual([]);
});

for (const approval of ['required', 'merge', 'push'] as const) {
	test(`with a start channel enabled, a version raised without a start follows ${approval}`, async () => {
		const { repository, api } = await configured([{ via: 'dashboard' }], 'pr', approval);
		await release(api, repository.id);
		await world.wait(16_000);
		const [pull] = repository.pulls;
		if (!pull) throw new Error('No version PR');
		expect(pull.body).not.toContain('A start from');
		const merged = world.github.merge(repository, pull.number);
		passChecks(repository, merged.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		const [promotion, ...more] = await promotions(api);
		expect(more).toEqual([]);
		expect(promotion).not.toHaveProperty('started');
		if (approval === 'required') expect(promotion).toMatchObject({ state: 'awaiting-approval' });
		else {
			expect(promotion?.state).not.toBe('awaiting-approval');
			expect(promotion?.approvedBy).toBe(approval === 'merge' ? 'merge' : undefined);
		}
	});
}

async function refusedBump() {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	repository.protectedBranches.add(repository.defaultBranch);
	const source = world.github.head(repository);
	await release(api, repository.id);
	await world.wait(16_000);
	const [prepared] = (await executions(api)).filter(entry => entry.operation === 'prepare');
	const head = prepared?.managed?.head;
	if (!prepared || !head) throw new Error('The refused bump recorded no commit');
	expect(prepared.state).toBe('failed');
	const retry = async () => {
		expect((await api('/api/executions/recover', { id: prepared.id, action: 'retry' })).status).toBe(200);
		await world.wait(16_000);
		return (await executions(api)).find(entry => entry.id === prepared.id);
	};
	return { repository, api, source, head, retry };
}

test('retrying a refused commit bump after the protection lifts pushes the recorded commit', async () => {
	const { repository, api, source, head, retry } = await refusedBump();
	repository.protectedBranches.clear();
	expect(await retry()).toMatchObject({ state: 'succeeded', managed: { result: { head, kind: 'commit' } } });
	expect(world.github.resolve(repository, repository.defaultBranch)).toMatchObject({ sha: head, parents: [source] });
	passChecks(repository, head);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	await publishedOnce(api, repository, 'cli');
});

test('a commit bump that reached the default branch below later commits counts as landed', async () => {
	const { repository, api, head, retry } = await refusedBump();
	repository.protectedBranches.clear();
	repository.refs.set(`heads/${repository.defaultBranch}`, head);
	const later = world.github.push(repository, { 'NOTES.md': 'Later work\n' }, 'Continue after the bump');
	expect(await retry()).toMatchObject({ state: 'succeeded', managed: { result: { head } } });
	expect(world.github.head(repository)).toBe(later.sha);
	passChecks(repository, head);
	passChecks(repository, later.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toEqual([
		expect.objectContaining({ sourceSha: head, approvedBy: 'start', version: '1.0.1' }),
	]);
});

test('a default branch that moved past the bump source stops the commit bump with a reason', async () => {
	const { repository, retry } = await refusedBump();
	repository.protectedBranches.clear();
	const moved = world.github.push(repository, { 'NOTES.md': 'Other work\n' }, 'Move the branch');
	expect(await retry()).toMatchObject({
		state: 'failed',
		reason: `main moved to ${moved.sha.slice(0, 12)} before the version commit landed. Start the release again.`,
	});
});

test('a stream with tag versions cannot start a release', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.versionSource = { kind: 'tags', prefix: 'v' };
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Read versions from tags',
	);
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.0.1' };
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId } = plan.parse(planned.body);
	const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId });
	expect(refused.status).toBe(422);
	expect(JSON.stringify(refused.body)).toContain(
		'main cannot start releases: it needs one shared version kept in its manifests',
	);
});

test('the release action refreshes a stale branch head and refuses a run on another branch or an old commit', async () => {
	const { repository, api } = await configured([{ via: 'action', workflow: 'start-release.yml' }], 'commit');
	const old = world.github.head(repository);
	const next = world.github.push(repository, { 'NOTES.md': 'Unseen\n' }, 'Push without a webhook');
	passChecks(repository, next.sha);
	const start = async (sha: string, ref?: string) =>
		bearer(
			world,
			await world.runToken({ repository, runId: 78, sha, file: 'start-release.yml', ...(ref ? { ref } : {}) }),
		)('/api/workflow/start', { stream: 'main', version: 'patch' });
	const branch = await start(next.sha, 'refs/heads/feature');
	expect(branch.status).toBe(403);
	expect(JSON.stringify(branch.body)).toContain('Start the release from main');
	const stale = await start(old);
	expect(stale.status).toBe(409);
	expect(JSON.stringify(stale.body)).toContain('main moved after this run started. Run the workflow again.');
	const started = await start(next.sha);
	expect(started.status).toBe(200);
	expect(execution.parse(started.body)).toMatchObject({ operation: 'prepare' });
	await landed(repository);
	await publishedOnce(api, repository, 'action');
});
