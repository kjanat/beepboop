import { expect, spyOn, test } from 'bun:test';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId } from '@root/test/support/github.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { executions, promotions } from '@root/test/support/releases.ts';
import {
	dispatchedPublishWorkflow,
	editableConfiguration,
	licenseText,
	npmManifest,
	passChecks,
	plugin,
	widget,
} from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect, Schema, Struct } from 'effect';
import type { ApprovalPolicy, ReleaseStart, VersionBump } from '@/domain/release-start.ts';
import { publishWhenNames, versionLandsNames, versionScopeNames } from '@/domain/setup-terms.ts';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/kernel/schema/structs.ts';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/kernel/schema/structs.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

type Api = (path: string, body?: unknown) => Promise<Reply>;

let world: World;
eachWorld(created => {
	world = created;
});

const plan = looseStruct({ sourceSha: Schema.String, planId: Schema.String, starts: Schema.Boolean });
const execution = looseStruct({ id: Schema.String, operation: Schema.String, state: Schema.String });

async function configured(
	start: ReleaseStart[],
	bump?: VersionBump,
	approval: ApprovalPolicy = 'required',
	versioning: 'workspace' | 'independent' = 'workspace',
) {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main = {
		...configuration.streams.main,
		credentials: [],
		startFrom: start.filter(entry => entry.via === 'action'),
		versionScope: versionScopeNames[versioning],
		prepare: { strategy: 'managed', ...(bump ? { versionLands: versionLandsNames[bump] } : {}) },
		promote: { ...configuration.streams.main.promote, publishWhen: publishWhenNames[approval] },
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

async function release(
	send: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>,
	id: number,
	options: { version?: unknown; force?: boolean } = {},
) {
	const started = await prepared(send, id, options);
	expect(started.status).toBe(200);
	return decodeSync(execution, started.body);
}

async function prepared(
	send: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>,
	id: number,
	{ version = { bump: 'patch' }, force }: { version?: unknown; force?: boolean },
) {
	const request = { repositoryId: id, stream: 'main', version };
	const planned = await send('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	return send('/api/releases/prepare', { ...request, sourceSha, planId, start: starts, ...(force ? { force } : {}) });
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

test('a started version PR that gained another commit waits for approval when merged', async () => {
	const { repository, api } = await configured([{ via: 'dashboard' }], 'pr');
	await release(fromDashboard, repository.id);
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	world.github.push(repository, { 'CHANGELOG.md': '# 1.0.1\n' }, 'Write the release notes', pull.head.ref);
	const merged = world.github.merge(repository, pull.number, 'squash');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [promotion, ...more] = await promotions(api);
	expect(more).toEqual([]);
	expect([promotion?.sourceSha, promotion?.state, promotion?.approvedBy, promotion?.started]).toEqual([
		merged.sha,
		'awaiting-approval',
		undefined,
		undefined,
	]);
	expect(repository.runs).toEqual([]);
});

test('merging a version PR promotes a mixed manifest and already-tagged Go stream', async () => {
	const repository = widget(world.github, { configured: false });
	world.npm.publish('widget', '1.0.0');
	world.network.serve('proxy.golang.org', () => Response.json({ Version: 'v1.0.0' }));
	world.github.recordTag(repository, 'go/v1.0.0', 'd'.repeat(40), world.github.head(repository), true);
	const configuration = {
		managers: ['npm', 'go', 'workflow'],
		streams: {
			main: {
				packages: ['pkg:npm/widget', 'pkg:golang/github.com/octo/widget/go'],
				mustPublish: ['pkg:npm/widget', 'pkg:golang/github.com/octo/widget/go'],
				prepare: { strategy: 'managed' },
				promote: {
					publishWhen: 'version-pr-merged',
					workflow: { file: 'publish.yml', publications: ['pkg:npm/widget', 'pkg:golang/github.com/octo/widget/go'] },
				},
			},
		},
	};
	world.github.push(repository, {
		'go/go.mod': 'module github.com/octo/widget/go\n\ngo 1.26\n',
		'.github/beepboop.json': JSON.stringify(configuration),
	}, 'Configure mixed release');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId } = decodeSync(plan, planned.body);
	expect((await api('/api/releases/prepare', { ...request, sourceSha, planId, start: true })).status).toBe(200);
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toEqual([
		expect.objectContaining({
			sourceSha: merged.sha,
			version: '1.1.0',
			approvedBy: 'start',
			started: { via: 'cli', actor: expect.any(String) },
		}),
	]);
	expect(repository.runs).toHaveLength(1);
	expect(repository.runs[0]?.path).toBe('.github/workflows/publish.yml');
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toHaveLength(1);
	expect(repository.runs).toHaveLength(1);
});

const dashboardRelease: {
	submitRelease(request: { repositoryId: number; stream: string; version: unknown }): Effect.Effect<unknown, unknown>;
} = await import(new URL('../../src/ui/browser/release.ts', import.meta.url).href);

test.each(
	[
		['workspace', { via: 'dashboard' }],
		['independent', undefined],
	] as const,
)('the dashboard asks a %s stream for a start only when its plan offers one', async (versioning, started) => {
	const { repository } = await configured([], 'pr', 'required', versioning);
	const cookie = await world.adminCookie();
	const fetched = spyOn(globalThis, 'fetch').mockImplementation(
		Object.assign((input: string | URL | Request, init?: RequestInit) =>
			world.handle(
				new Request(new URL(String(input), origin), {
					...init,
					headers: { ...init?.headers, Cookie: cookie, Origin: origin },
				}),
			), { preconnect: fetch.preconnect }),
	);
	const run = await Effect.runPromise(
		dashboardRelease.submitRelease({ repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } }),
	).finally(() => fetched.mockRestore());
	if (started) expect(run).toMatchObject({ operation: 'prepare', started });
	else expect(run).not.toHaveProperty('started');
});

test('a request with start false prepares a startable stream, and its merged version PR waits for approval', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'pr');
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const planned = await api('/api/releases/plan', request);
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	expect(starts).toBe(true);
	const prepared = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: false });
	expect(prepared.status).toBe(200);
	expect(prepared.body).not.toHaveProperty('started');
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	expect(pull.body).not.toContain('Started from');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [promotion, ...more] = await promotions(api);
	expect(more).toEqual([]);
	expect(promotion).toMatchObject({ sourceSha: merged.sha, state: 'awaiting-approval' });
	expect(promotion).not.toHaveProperty('started');
});

test.each(
	[
		['workspace', { via: 'cli' }],
		['independent', undefined],
	] as const,
)(
	'a request without start, as an older CLI sends it, starts a %s stream only when it can',
	async (versioning, started) => {
		const { repository, api } = await configured([], 'pr', 'required', versioning);
		const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
		const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
		const prepared = await api('/api/releases/prepare', { ...request, sourceSha, planId });
		expect(prepared.status).toBe(200);
		if (started) expect(prepared.body).toMatchObject({ started });
		else expect(prepared.body).not.toHaveProperty('started');
	},
);

test('force with start false still starts the release', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
	const forced = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: false, force: true });
	expect(forced.status).toBe(200);
	expect(forced.body).toMatchObject({ started: { via: 'cli', force: true } });
});

test('a request for one of two manifest packages in a shared-version stream cannot start', async () => {
	const repository = widget(world.github, { configured: false });
	world.npm.publish('widget', '1.0.0');
	world.npm.publish('gadget', '1.0.0');
	const packages = ['pkg:npm/widget', 'pkg:npm/gadget'];
	world.github.push(repository, {
		'packages/gadget/package.json': npmManifest('gadget', '1.0.0'),
		'packages/gadget/README.md': '# gadget\n',
		'packages/gadget/LICENSE': licenseText,
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages,
					mustPublish: packages,
					credentials: [],
					prepare: { strategy: 'managed' },
					promote: { workflow: { file: 'publish.yml', publications: packages } },
				},
			},
		}),
	}, 'Release two packages together');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0', packages: ['pkg:npm/widget'] };
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	expect(starts).toBe(false);
	const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: true });
	expect(refused.status).toBe(422);
	expect(text(refused.body, 'error')).toBe(
		'main shares one version across its packages, and a release of only some of them does not start publication',
	);
	expect(await executions(api)).toEqual([]);
});

test('a request for only some packages of a shared-version stream cannot start and its merge publishes nothing', async () => {
	const repository = widget(world.github, { configured: false });
	world.npm.publish('widget', '1.0.0');
	world.network.serve('proxy.golang.org', () => Response.json({ Version: 'v1.0.0' }));
	world.github.recordTag(repository, 'go/v1.0.0', 'd'.repeat(40), world.github.head(repository), true);
	const packages = ['pkg:npm/widget', 'pkg:golang/github.com/octo/widget/go'];
	world.github.push(repository, {
		'go/go.mod': 'module github.com/octo/widget/go\n\ngo 1.26\n',
		'version.json': '{"version":"1.0.0"}\n',
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'go', 'workflow'],
			streams: {
				main: {
					packages,
					mustPublish: packages,
					versionFiles: [{ path: 'version.json', format: 'json', key: ['version'] }],
					prepare: { strategy: 'managed' },
					promote: { publishWhen: 'version-pr-merged', workflow: { file: 'publish.yml', publications: packages } },
				},
			},
		}),
	}, 'Configure mixed release');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = {
		repositoryId: repository.id,
		stream: 'main',
		version: '1.1.0',
		packages: ['pkg:golang/github.com/octo/widget/go'],
	};
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	expect(starts).toBe(false);
	const refusal =
		'main shares one version across its packages, and a release of only some of them does not start publication';
	for (const consent of [{ start: true }, { force: true }]) {
		const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId, ...consent });
		expect(refused.status).toBe(422);
		expect(text(refused.body, 'error')).toBe(refusal);
	}
	const prepared = await api('/api/releases/prepare', { ...request, sourceSha, planId });
	expect(prepared.status).toBe(200);
	expect(prepared.body).not.toHaveProperty('started');
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toEqual([]);
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
	expect(decodeSync(execution, JSON.parse(result.outputs.result ?? '{}'))).toMatchObject({ operation: 'prepare' });
	await landed(repository);
	await publishedOnce(api, repository, 'action');
});

for (const via of ['cli', 'dashboard'] as const) {
	test(`a release from the ${via} starts and publishes once although startFrom lists only the action`, async () => {
		const { repository, api } = await configured([{ via: 'action', workflow: 'start-release.yml' }], 'commit');
		await release(via === 'cli' ? api : fromDashboard, repository.id);
		await landed(repository);
		await publishedOnce(api, repository, via);
	});
}

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
			reason: expect.stringMatching(
				/^GitHub refused the version commit on main: .*, or set prepare\.versionLands to "via-version-pr"\.$/,
			),
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
		expect.objectContaining({ state: 'failed', reason: 'checks failed: test', approvedBy: 'start' }),
	]);
	expect(repository.runs).toEqual([]);
});

test('starting a release that stopped on checks again publishes it once its checks pass', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	await release(api, repository.id);
	await world.wait(16_000);
	const head = world.github.head(repository);
	repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'cancelled', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [stopped] = await promotions(api);
	expect(stopped).toMatchObject({ state: 'failed', reason: 'checks failed: test (cancelled)' });
	passChecks(repository, head);
	const restarted = await release(api, repository.id, { version: '1.0.1' });
	expect(restarted).toMatchObject({ id: stopped?.id, state: 'awaiting-approval' });
	await world.wait(16_000);
	expect(repository.runs.map(run => run.inputs.beepboop_execution_id)).toEqual([stopped?.id]);
});

test('retrying a release that stopped on checks dispatches it without waiting for another event', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	await release(api, repository.id);
	await world.wait(16_000);
	const head = world.github.head(repository);
	repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'cancelled', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [stopped] = await promotions(api);
	passChecks(repository, head);
	expect((await api('/api/executions/recover', { id: stopped?.id, action: 'retry' })).status).toBe(200);
	await world.wait(1_000);
	expect(repository.runs.map(run => run.inputs.beepboop_execution_id)).toEqual([stopped?.id]);
});

test('a forced release publishes over failing checks and missing package metadata', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const stripped = world.github.push(repository, { 'README.md': null }, 'Remove the README');
	passChecks(repository, stripped.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await release(api, repository.id, { force: true });
	await world.wait(16_000);
	const head = world.github.head(repository);
	repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [promotion, ...more] = await promotions(api);
	expect(more).toEqual([]);
	expect(promotion).toMatchObject({ approvedBy: 'start', started: { via: 'cli', force: true } });
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion?.id);
	if (!run || !promotion) throw new Error('The forced release dispatched no run');
	run.status = 'in_progress';
	const begun = await begin(world, runIdentity(repository, run, 'publish.yml'), promotion.id, 'main', 'promote');
	expect(JSON.parse(begun.outputs.context ?? '{}')).toMatchObject({ id: promotion.id, force: true });
});

test('a stopped release starts again under force and dispatches over its failed check', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	await release(api, repository.id);
	await world.wait(16_000);
	const head = world.github.head(repository);
	repository.checks.set(head, [{ name: 'test', status: 'completed', conclusion: 'cancelled', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [stopped] = await promotions(api);
	expect(stopped?.state).toBe('failed');
	await release(api, repository.id, { version: '1.0.1', force: true });
	await world.wait(1_000);
	expect(repository.runs.map(run => run.inputs.beepboop_execution_id)).toEqual([stopped?.id]);
});

test('forcing a release whose workflow failed dispatches the workflow again', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	await release(api, repository.id);
	const head = await landed(repository);
	const [promotion] = await promotions(api);
	const [first] = repository.runs;
	if (!first || !promotion) throw new Error('The started release dispatched no run');
	first.status = 'completed';
	first.conclusion = 'failure';
	await world.workflowRun(repository, first, 'failure', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await promotions(api))[0]?.state).toBe('failed');
	repository.checks.set(head.sha, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 1 }]);
	await release(api, repository.id, { version: '1.0.1', force: true });
	first.status = 'in_progress';
	await expect(begin(world, runIdentity(repository, first, 'publish.yml'), promotion.id, 'main', 'promote'))
		.rejects.toThrow('A newer run of this execution replaced this run');
	await world.wait(16_000);
	expect(repository.runs.map(run => [run.inputs.beepboop_execution_id, run.id === first.id])).toEqual([
		[promotion.id, true],
		[promotion.id, false],
	]);
	const [, second] = repository.runs;
	if (!second) throw new Error('The forced release dispatched no second run');
	second.status = 'in_progress';
	const begun = await begin(world, runIdentity(repository, second, 'publish.yml'), promotion.id, 'main', 'promote');
	expect(JSON.parse(begun.outputs.context ?? '{}')).toMatchObject({ id: promotion.id, force: true });
});

test('forcing a release whose version PR is open carries the force to its promotion', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'pr');
	await release(api, repository.id);
	await world.wait(16_000);
	await release(api, repository.id, { force: true });
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	const merged = world.github.merge(repository, pull.number);
	repository.checks.set(merged.sha, [{ name: 'test', status: 'completed', conclusion: 'cancelled', runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [promotion] = await promotions(api);
	expect(promotion).toMatchObject({ approvedBy: 'start', started: { force: true } });
	expect(repository.runs.map(run => run.inputs.beepboop_execution_id)).toEqual([promotion?.id]);
});

test('force is refused for a stream that cannot start releases', async () => {
	const { repository, api } = await configured([], 'commit', 'required', 'independent');
	const refused = await prepared(api, repository.id, { force: true });
	expect(refused.status).toBe(422);
	expect(JSON.stringify(refused.body)).toContain('main cannot start releases: it needs one shared version');
	expect(await executions(api)).toEqual([]);
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
			reason: expect.stringContaining('metadata incomplete: '),
		}),
	]);
	expect(repository.runs).toEqual([]);
});

for (const approval of ['required', 'merge', 'push'] as const) {
	test(`a version PR of a stream that cannot start follows ${approval} when merged`, async () => {
		const { repository, api } = await configured([], 'pr', approval, 'independent');
		expect(await release(api, repository.id)).not.toHaveProperty('started');
		await world.wait(16_000);
		const [pull] = repository.pulls;
		if (!pull) throw new Error('No version PR');
		expect(pull.body).not.toContain('Started from');
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

test('a tag-based stream without a promotion that publishes the version tag only prepares and refuses force', async () => {
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
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	expect(starts).toBe(false);
	const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId, force: true });
	expect(refused.status).toBe(422);
	expect(text(refused.body, 'error')).toBe(
		'main needs a dispatchable promotion that publishes a version tag with prefix "v"',
	);
	expect(await executions(api)).toEqual([]);
	const preparation = await api('/api/releases/prepare', { ...request, sourceSha, planId });
	expect(preparation.status).toBe(200);
	expect(decodeSync(execution, preparation.body)).toMatchObject({ operation: 'prepare' });
	expect(preparation.body).not.toHaveProperty('started');
});

test.each([false, true])(
	'a private plugin release starts and publishes on merge (unrelated npm package: %p)',
	async unrelated => {
		const repository = plugin(world.github);
		const githubRelease = `github-release:${repository.name}`;
		const baseline = world.github.head(repository);
		repository.refs.set('tags/0.1.0', baseline);
		repository.refs.set('tags/v9.0.0', baseline);
		const head = world.github.push(repository, {
			...(unrelated ? { 'package.json': npmManifest('widget', '1.0.0') } : {}),
			'.github/workflows/publish.yml': dispatchedPublishWorkflow('Publish', 'main', 'release', ''),
			'.github/beepboop.json': JSON.stringify({
				managers: ['npm', 'cargo', 'workflow', 'github-release'],
				streams: {
					main: {
						...(unrelated ? { packages: [] } : {}),
						versionFiles: [{ path: 'Cargo.toml', format: 'toml', key: ['package', 'version'] }],
						startFrom: [{ via: 'action', workflow: 'start-release.yml' }],
						prepare: { strategy: 'managed' },
						promote: {
							workflow: { file: 'publish.yml', refs: { phase: 'version', prefix: '' }, publications: [githubRelease] },
						},
						mustPublish: [githubRelease],
					},
				},
			}),
		}, 'Manage the plugin version in its private Cargo manifest');
		passChecks(repository, head.sha);
		const api = bearer(world, await world.cliSession());
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const result = await runAction(
			world,
			'start',
			{ repository, runId: 77, sha: head.sha, file: 'start-release.yml' },
			{ STREAM: 'main', RELEASE_VERSION: 'patch' },
		);
		expect(decodeSync(execution, JSON.parse(result.outputs.result ?? '{}'))).toMatchObject({ operation: 'prepare' });
		await world.wait(16_000);
		const [pull] = repository.pulls;
		if (!pull) throw new Error('No version PR');
		expect(await promotions(api)).toEqual([]);
		const merged = world.github.merge(repository, pull.number);
		expect(world.github.file(repository, 'Cargo.toml')).toContain('version = "0.1.1"');
		passChecks(repository, merged.sha);
		const later = world.github.push(repository, { 'NOTES.md': 'Later work\n' }, 'Continue after the release PR');
		passChecks(repository, later.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		await world.wait(16_000);
		const [promotion, ...others] = await promotions(api);
		expect(others).toEqual([]);
		expect(promotion).toMatchObject({
			version: '0.1.1',
			sourceSha: merged.sha,
			approvedBy: 'start',
			started: { via: 'action' },
		});
		const request = { repositoryId: repository.id, stream: 'main', version: '0.1.1' };
		const planned = await api('/api/releases/plan', request);
		expect(planned.status).toBe(200);
		const { sourceSha, planId } = decodeSync(plan, planned.body);
		expect(sourceSha).toBe(merged.sha);
		const prepared = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: true });
		expect(prepared.status).toBe(200);
		expect(prepared.body).toMatchObject({ id: promotion?.id, sourceSha: merged.sha });
		expect(repository.runs.map(run => run.inputs.beepboop_execution_id)).toEqual([promotion?.id]);
	},
);

test('a tag-based dashboard start promotes the reviewed version after its version PR merges', async () => {
	const { repository, api } = await configured([{ via: 'dashboard' }]);
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.managers = ['workflow'];
	const stream = configuration.streams.main;
	stream.packages = [];
	stream.mustPublish = [];
	stream.versionSource = { kind: 'tags', prefix: 'v' };
	stream.versionFiles = [{ path: 'package.json', format: 'json', key: ['version'] }];
	stream.promote.workflow.refs = { phase: 'version', prefix: 'v' };
	stream.promote.workflow.publications = [];
	repository.refs.set('tags/v2.3.4', world.github.head(repository));
	const configuredHead = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Configure a tag-based release',
	);
	passChecks(repository, configuredHead.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(await promotions(api)).toEqual([]);

	expect(await release(fromDashboard, repository.id)).toMatchObject({ operation: 'prepare' });
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No version PR');
	expect(await promotions(api)).toEqual([]);
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect(await promotions(api)).toEqual([
		expect.objectContaining({
			version: '2.3.5',
			sourceSha: merged.sha,
			approvedBy: 'start',
			started: { via: 'dashboard', actor: expect.any(String) },
		}),
	]);
});

async function taggedWithPolicy(approval: ApprovalPolicy, bump: VersionBump) {
	const { repository, api } = await configured([], bump, approval);
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.managers = ['workflow'];
	const stream = configuration.streams.main;
	stream.packages = [];
	stream.mustPublish = [];
	stream.versionSource = { kind: 'tags', prefix: 'v' };
	stream.versionFiles = [{ path: 'package.json', format: 'json', key: ['version'] }];
	stream.promote.workflow.refs = { phase: 'version', prefix: 'v' };
	stream.promote.workflow.publications = [];
	repository.refs.set('tags/v2.3.4', world.github.head(repository));
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Configure a tag-based release',
	);
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
	const prepared = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: false });
	expect(prepared.status).toBe(200);
	expect(prepared.body).not.toHaveProperty('started');
	return { repository, api };
}

for (const approval of ['required', 'merge'] as const) {
	test(`a tag-based version PR prepared without a start follows ${approval} when merged`, async () => {
		const { repository, api } = await taggedWithPolicy(approval, 'pr');
		await world.wait(16_000);
		const [pull] = repository.pulls;
		if (!pull) throw new Error('No version PR');
		const merged = world.github.merge(repository, pull.number);
		passChecks(repository, merged.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		const [promotion, ...more] = await promotions(api);
		expect(more).toEqual([]);
		expect(promotion).toMatchObject({ version: '2.3.5', sourceSha: merged.sha });
		expect(promotion).not.toHaveProperty('started');
		if (approval === 'required') expect(promotion).toMatchObject({ state: 'awaiting-approval' });
		else {
			expect(promotion?.approvedBy).toBe('merge');
			expect(promotion?.state).not.toBe('awaiting-approval');
		}
	});
}

test.each([false, true])(
	'a tag-based version commit prepared without a start waits for approval, compare failing first: %p',
	async failing => {
		const { repository, api } = await taggedWithPolicy('merge', 'commit');
		const refused: string[] = [];
		let refusing = failing;
		world.network.serve('api.github.com', request => {
			const path = new URL(request.url).pathname;
			const head = world.github.resolve(repository, repository.defaultBranch).sha;
			if (!refusing || path !== `/repos/${repository.name}/compare/${head}...${head}`) {
				return world.github.handle(request);
			}
			refused.push(path);
			return Response.json({ message: 'Comparison unavailable' }, { status: 503 });
		});
		const head = await landed(repository);
		if (failing) {
			expect(refused).not.toEqual([]);
			expect(await promotions(api)).toEqual([]);
			refusing = false;
			expect((await world.push(repository)).status).toBe(202);
			await world.wait(16_000);
		}
		const [promotion, ...more] = await promotions(api);
		expect(more).toEqual([]);
		expect(promotion).toMatchObject({ version: '2.3.5', sourceSha: head.sha, state: 'awaiting-approval' });
		expect(promotion).not.toHaveProperty('approvedBy');
	},
);

test.each(
	[
		['failed', 'unstarted'],
		['cancelled', 'unstarted'],
		['failed', 'started'],
		['failed', 'forced'],
	] as const,
)('a start for a %s %s preparation restarts it and publishes', async (stopped, first) => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
	if (stopped === 'failed') repository.protectedBranches.add(repository.defaultBranch);
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha,
		planId,
		start: first !== 'unstarted',
		...(first === 'forced' ? { force: true } : {}),
	});
	const { id } = decodeSync(execution, prepared.body);
	const stored = async () => (await executions(api)).find(entry => entry.id === id);
	if (stopped === 'cancelled') {
		expect((await api('/api/executions/cancel', { id })).status).toBe(200);
		expect(await stored()).toHaveProperty('cancelledBy');
	} else await world.wait(16_000);
	expect((await stored())?.state).toBe(stopped);
	repository.protectedBranches.clear();
	const restarted = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: true });
	expect(restarted.status).toBe(200);
	expect(decodeSync(execution, restarted.body)).toMatchObject({ id, state: 'ready' });
	expect(restarted.body).toMatchObject({ started: { via: 'cli', ...(first === 'forced' ? { force: true } : {}) } });
	expect(await stored()).not.toHaveProperty('cancelledBy');
	const head = await landed(repository);
	expect(head).toMatchObject({ message: 'chore(release): 1.0.1', authorId: botId });
	expect((await stored())?.state).toBe('succeeded');
	await publishedOnce(api, repository, 'cli');
});

test('a start that restarts a superseded preparation supersedes the pending one', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.concurrency = 'supersede-pending';
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Supersede pending work',
	);
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const prepare = async (version: string, start: boolean) => {
		const request = { repositoryId: repository.id, stream: 'main', version };
		const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
		const response = await api('/api/releases/prepare', { ...request, sourceSha, planId, start });
		expect(response.status).toBe(200);
		return decodeSync(execution, response.body);
	};
	const older = await prepare('1.0.1', false);
	const newer = await prepare('1.1.0', false);
	const state = async (id: string) => (await executions(api)).find(entry => entry.id === id)?.state;
	expect([await state(older.id), await state(newer.id)]).toEqual(['cancelled', 'ready']);
	expect(await prepare('1.0.1', true)).toMatchObject({ id: older.id, state: 'ready' });
	expect([await state(older.id), await state(newer.id)]).toEqual(['ready', 'cancelled']);
});

test('a refused restart of a superseded preparation leaves the pending one ready', async () => {
	const { repository, api } = await configured([{ via: 'cli' }], 'commit');
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.concurrency = 'supersede-pending';
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Supersede pending work',
	);
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const planned = async (version: string) => {
		const request = { repositoryId: repository.id, stream: 'main', version };
		const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
		return { ...request, sourceSha, planId };
	};
	const older = decodeSync(
		execution,
		(await api('/api/releases/prepare', { ...await planned('1.0.1'), start: false })).body,
	);
	const newer = decodeSync(
		execution,
		(await api('/api/releases/prepare', { ...await planned('1.1.0'), start: false })).body,
	);
	const restart = await planned('1.0.1');
	const refused: string[] = [];
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		const body = path.endsWith('/access_tokens') ? await request.clone().text() : '';
		if (!body.includes('"actions":"write"')) return world.github.handle(request);
		refused.push(path);
		return Response.json({ message: 'Installation tokens are unavailable' }, { status: 503 });
	});
	expect((await api('/api/releases/prepare', { ...restart, start: true })).status).not.toBe(200);
	expect(refused).not.toEqual([]);
	const state = async (id: string) => (await executions(api)).find(entry => entry.id === id)?.state;
	expect([await state(older.id), await state(newer.id)]).toEqual(['cancelled', 'ready']);
});

test.each(['unopened', 'open', 'edited', 'refusing edits'] as const)(
	'a start for a version prepared without one starts it, its PR %s',
	async pr => {
		const { repository, api } = await configured([{ via: 'cli' }], 'pr');
		const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
		const { sourceSha, planId } = decodeSync(plan, (await api('/api/releases/plan', request)).body);
		const first = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: false });
		expect(first.body).not.toHaveProperty('started');
		if (pr === 'unopened') expect(repository.pulls).toEqual([]);
		else {
			await world.wait(16_000);
			expect(repository.pulls.map(entry => entry.body)).toEqual([
				expect.stringContaining('`publishWhen: approved-in-beepboop`'),
			]);
		}
		const edited = 'Release notes written by hand';
		if (pr === 'edited' && repository.pulls[0]) repository.pulls[0].body = edited;
		const refused: string[] = [];
		if (pr === 'refusing edits') {
			world.network.serve('api.github.com', request => {
				const path = new URL(request.url).pathname;
				if (request.method !== 'PATCH' || path !== `/repos/${repository.name}/pulls/1`) {
					return world.github.handle(request);
				}
				refused.push(path);
				return Response.json({ message: 'Pull request edits are unavailable' }, { status: 503 });
			});
		}
		const second = await api('/api/releases/prepare', { ...request, sourceSha, planId, start: true });
		expect(second.status).toBe(200);
		expect(decodeSync(execution, second.body).id).toBe(decodeSync(execution, first.body).id);
		expect(second.body).toMatchObject({ started: { via: 'cli' } });
		await world.wait(16_000);
		const [pull, ...others] = repository.pulls;
		if (!pull) throw new Error('No version PR');
		expect(others).toEqual([]);
		if (pr === 'edited') expect(pull.body).toBe(edited);
		else if (pr === 'refusing edits') {
			expect(refused).not.toEqual([]);
			expect(pull.body).toContain('`publishWhen: approved-in-beepboop`');
		} else {
			expect(pull.body).toContain(
				'Started from the CLI. Merging this PR publishes the release, and nothing asks again.',
			);
			expect(pull.body).not.toContain('publishWhen');
		}
		const merged = world.github.merge(repository, pull.number);
		passChecks(repository, merged.sha);
		expect((await world.push(repository)).status).toBe(202);
		await world.wait(16_000);
		await publishedOnce(api, repository, 'cli');
	},
);

test.each(['tag-based', 'manifest'])(
	'a %s stream with delegated preparation cannot start and refuses force before dispatching',
	async kind => {
		const { repository, api } = await configured([{ via: 'cli' }]);
		const configuration = editableConfiguration();
		const stream = configuration.streams.main;
		if (kind === 'tag-based') {
			stream.versionSource = { kind: 'tags', prefix: 'v' };
			stream.promote.workflow.refs = { phase: 'version', prefix: 'v' };
		}
		stream.prepare = { strategy: 'workflow', workflow: { file: 'publish.yml' } };
		const head = world.github.push(
			repository,
			{ '.github/beepboop.json': JSON.stringify(configuration) },
			'Delegate preparation',
		);
		passChecks(repository, head.sha);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const request = { repositoryId: repository.id, stream: 'main', version: '1.0.1' };
		const planned = await api('/api/releases/plan', request);
		expect(planned.status).toBe(200);
		const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
		expect(starts).toBe(false);
		const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId, force: true });
		expect(refused.status).toBe(422);
		expect(JSON.stringify(refused.body)).toContain(
			'main prepares its version in publish.yml, and Beepboop cannot follow that preparation to its merge',
		);
		expect(await executions(api)).toEqual([]);
	},
);

test('a stream whose own packages keep no manifest version only prepares and refuses force', async () => {
	const repository = widget(world.github, { configured: false });
	world.npm.publish('widget', '1.0.0');
	world.network.serve('proxy.golang.org', () => Response.json({ Version: 'v1.0.0' }));
	world.github.recordTag(repository, 'go/v1.0.0', 'd'.repeat(40), world.github.head(repository), true);
	const module = 'pkg:golang/github.com/octo/widget/go';
	world.github.push(repository, {
		'go/go.mod': 'module github.com/octo/widget/go\n\ngo 1.26\n',
		'version.json': '{"version":"1.0.0"}\n',
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'go', 'workflow'],
			streams: {
				main: {
					packages: [module],
					mustPublish: [module],
					versionFiles: [{ path: 'version.json', format: 'json', key: ['version'] }],
					prepare: { strategy: 'managed' },
					promote: { workflow: { file: 'publish.yml', publications: [module] } },
				},
			},
		}),
	}, 'Release the Go module alone');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	const { sourceSha, planId, starts } = decodeSync(plan, planned.body);
	expect(starts).toBe(false);
	const refused = await api('/api/releases/prepare', { ...request, sourceSha, planId, force: true });
	expect(refused.status).toBe(422);
	expect(JSON.stringify(refused.body)).toContain(
		'main keeps its version outside package manifests, and merging a version bump there does not start publication',
	);
	expect(await executions(api)).toEqual([]);
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
	expect(decodeSync(execution, started.body)).toMatchObject({ operation: 'prepare' });
	await landed(repository);
	await publishedOnce(api, repository, 'action');
});

test('force restarts the stopped promotion that created the latest plugin tag at its original commit', async () => {
	const repository = plugin(world.github);
	const publication = `github-release:${repository.name}`;
	const head = world.github.push(repository, {
		'.github/workflows/publish.yml': dispatchedPublishWorkflow('Publish', 'main', 'release', ''),
		'.github/beepboop.json': JSON.stringify({
			managers: ['cargo', 'workflow', 'github-release'],
			streams: {
				main: {
					versionFiles: [{ path: 'Cargo.toml', format: 'toml', key: ['package', 'version'] }],
					prepare: { strategy: 'managed' },
					promote: {
						workflow: { file: 'publish.yml', refs: { phase: 'version', prefix: '' }, publications: [publication] },
					},
					mustPublish: [publication],
				},
			},
		}),
	}, 'Release the private plugin');
	passChecks(repository, head.sha);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const request = { repositoryId: repository.id, stream: 'main', version: '0.1.0' };
	const preview = (force = true) => api('/api/releases/plan', { ...request, force });
	const prepare = (force: boolean, reviewed: ReturnType<typeof decodePlan>) =>
		api('/api/releases/prepare', { ...request, ...reviewed, force, start: true });
	const decodePlan = (reply: Reply) => decodeSync(plan, reply.body);
	const original = await prepare(false, decodePlan(await preview(false)));
	expect(original.status).toBe(200);
	const { id } = decodeSync(execution, original.body);
	await world.wait(16_000);
	const [run] = repository.runs;
	if (!run) throw new Error('Expected a dispatched promotion');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, id, 'main', 'promote');
	await runAction(world, 'refs-plan', identity, { EXECUTION_ID: id });
	const oid = 'a'.repeat(40);
	const versionTag = { name: request.version, commit: head.sha, oid };
	const confirm = (tag: typeof versionTag) =>
		runAction(world, 'refs-complete', identity, { EXECUTION_ID: id, VERSION_TAG: JSON.stringify(tag) });
	await expect(confirm({ ...versionTag, commit: 'e'.repeat(40) })).rejects.toThrow('authorized ref plan');
	await expect(confirm({ ...versionTag, oid: head.sha })).rejects.toThrow('authorized ref plan');
	world.github.recordTag(repository, request.version, oid, head.sha, true);
	await confirm(versionTag);
	await expect(confirm({ ...versionTag, oid: 'd'.repeat(40) })).rejects.toThrow('Confirmed version tag changed');
	expect((await preview()).status).toBe(422);
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await promotions(api))[0]?.state).toBe('failed');
	const next = world.github.push(repository, { 'NOTES.md': 'Unrelated' }, 'Document the plugin');
	passChecks(repository, next.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	expect((await preview(false)).status).toBe(422);
	world.github.recordTag(repository, '0.2.0', 'b'.repeat(40), next.sha, true);
	expect((await preview()).status).toBe(422);
	repository.refs.delete('tags/0.2.0');
	world.github.recordTag(repository, request.version, 'c'.repeat(40), head.sha, true);
	expect((await preview()).status).toBe(422);
	world.github.recordTag(repository, request.version, 'c'.repeat(40), next.sha, true);
	expect((await preview()).status).toBe(422);
	world.github.recordTag(repository, request.version, oid, head.sha, true);
	const resumed = decodePlan(await preview());
	expect(resumed.sourceSha).toBe(head.sha);
	const [draft] = repository.releases;
	if (!draft) throw new Error('Expected a draft release');
	draft.draft = false;
	expect((await prepare(true, resumed)).status).toBe(422);
	draft.draft = true;
	expect((await prepare(false, resumed)).status).toBe(422);
	expect((await prepare(true, resumed)).body).toMatchObject({ id, sourceSha: head.sha, state: 'ready' });
	await world.wait(16_000);
	expect(repository.runs.map(entry => entry.inputs.beepboop_execution_id)).toEqual([id, id]);
	expect(repository.refs.get('tags/0.1.0')).toBe(oid);
	const retry = repository.runs[1];
	if (!retry) throw new Error('Expected a new workflow run');
	retry.status = 'in_progress';
	const retried = runIdentity(repository, retry, 'publish.yml');
	await begin(world, retried, id, 'main', 'promote');
	await runAction(world, 'refs-plan', retried, { EXECUTION_ID: id });
	await runAction(world, 'refs-complete', retried, { EXECUTION_ID: id, VERSION_TAG: JSON.stringify(versionTag) });
	await runAction(world, 'release', retried, { EXECUTION_ID: id });
	retry.status = 'completed';
	retry.conclusion = 'success';
	await world.workflowRun(repository, retry, 'success', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await promotions(api)).map(entry => [entry.id, entry.state])).toEqual([[id, 'succeeded']]);
	expect(repository.releases.map(entry => [entry.tag, entry.draft])).toEqual([['0.1.0', false]]);
	expect((await preview()).status).toBe(422);
});
