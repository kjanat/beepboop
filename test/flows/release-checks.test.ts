import { expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { CheckRun, Repository } from '@root/test/support/github.ts';
import type { Api } from '@root/test/support/http.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { releaseExecutions } from '@root/test/support/releases.ts';
import { npmManifest, passChecks, widget } from '@root/test/support/repositories.ts';
import { eachWorld, origin, World } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect, Schema } from 'effect';
import { streamGates } from '@/contract/views';
import { stoppedByGates } from '@/domain/release-gates.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import { runCard } from '@/server/views/runs';

let world: World;
eachWorld(created => {
	world = created;
});

const auditRows = mutableArray(mutableStruct({ actor: Schema.String, target: Schema.String }));

async function audit(action: string) {
	const rows = await world.db.prepare('SELECT actor, target FROM audit WHERE action=? ORDER BY created_at').bind(action)
		.all();
	return decodeSync(auditRows, rows.results);
}

interface Stop {
	checks?: CheckRun[];
	runs?: { id: number; status: 'completed' | 'in_progress' }[];
	credentials?: string[];
	reason?: string;
}

async function stopped(
	stop: Stop = {},
): Promise<{ repository: Repository; api: Api; sha: string; id: string }> {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					required: ['pkg:npm/widget'],
					prepare: { strategy: 'managed' },
					credentials: stop.credentials ?? [],
					release: { approval: 'push', workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] } },
				},
			},
		}),
	}, 'Configure releases');
	passChecks(repository, world.github.head(repository));
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const raised = world.github.push(repository, { 'package.json': npmManifest('widget', '1.1.0') }, 'Release 1.1.0');
	repository.checks.set(
		raised.sha,
		stop.checks ?? [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 7 }],
	);
	for (const run of stop.runs ?? [{ id: 7, status: 'completed' }]) {
		repository.runs.push({
			id: run.id,
			path: '.github/workflows/ci.yml',
			event: 'push',
			headSha: raised.sha,
			headBranch: repository.defaultBranch,
			status: run.status,
			conclusion: run.status === 'completed' ? 'failure' : null,
			attempt: 1,
			title: 'Release 1.1.0',
			inputs: {},
		});
	}
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [waiting] = await releaseExecutions(api);
	expect([waiting?.state, waiting?.reason]).toEqual(['awaiting-approval', stop.reason ?? 'checks failed: test']);
	return { repository, api, sha: raised.sha, id: waiting?.id ?? '' };
}

function dispatched(): (string | undefined)[] {
	return world.github.dispatches.filter(dispatch => dispatch.file === 'publish.yml').map(dispatch =>
		dispatch.inputs.beepboop_execution_id
	);
}

test('release without the check publishes this release and leaves the stream gate on', async () => {
	const { repository, api, sha, id } = await stopped();
	const chosen = await api('/api/executions/checks', { id, choice: 'skip' });
	expect(chosen.status).toBe(200);
	await world.wait(16_000);
	expect(dispatched()).toEqual([id]);
	const [skip] = await audit('release.checks.skip');
	expect(skip?.target).toBe(`${id}: check test`);
	expect((await audit('release.approve')).map(row => row.target)).toEqual([
		`${id}:${sha}:push skipping: check test failure, skipped by ${skip?.actor}`,
	]);
	const gates = decodeSync(
		streamGates,
		(await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' })).body,
	);
	expect(await audit('stream.gate.skip')).toEqual([]);
	expect(gates.gates.every(entry => entry.skipped === undefined)).toBe(true);
}, 60_000);

test('always release without the check switches the gate off for the stream', async () => {
	const { repository, api, id } = await stopped();
	expect((await api('/api/executions/checks', { id, choice: 'always' })).status).toBe(200);
	await world.wait(16_000);
	expect(dispatched()).toEqual([id]);
	expect((await audit('stream.gate.skip')).map(row => row.target)).toEqual(['octo/widget:main:check test']);
	const gates = decodeSync(
		streamGates,
		(await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' })).body,
	);
	expect(gates.gates.find(entry => entry.gate.kind === 'check')?.skipped).toBeDefined();
}, 60_000);

test('rerun and wait reruns the failed jobs and publishes once the check passes', async () => {
	const { repository, api, sha, id } = await stopped();
	expect((await api('/api/executions/checks', { id, choice: 'rerun' })).status).toBe(200);
	const run = repository.runs.find(entry => entry.id === 7);
	expect([run?.attempt, run?.status]).toEqual([2, 'queued']);
	expect((await audit('release.checks.rerun')).map(row => row.target)).toEqual([`${id}: 7`]);
	await world.wait(60_000);
	expect((await releaseExecutions(api)).map(entry => [entry.state, entry.reason])).toEqual([
		['awaiting-approval', 'test running'],
	]);
	expect(dispatched()).toEqual([]);
	passChecks(repository, sha);
	await world.wait(60_000);
	expect(dispatched()).toEqual([id]);
}, 60_000);

test('a started release that stopped on its checks waits again after a choice', async () => {
	const { repository, api, id } = await stopped();
	const [waiting] = await releaseExecutions(api);
	if (!waiting) throw new Error('Expected a releaseExecution');
	await world.coordinator(repository).enqueue({
		...waiting,
		approvedBy: 'start',
		started: { via: 'cli', actor: 'owner' },
	});
	await world.wait(16_000);
	const [failed] = await releaseExecutions(api);
	expect([failed?.state, failed?.reason]).toEqual(['failed', 'checks failed: test']);
	if (!failed) throw new Error('Expected a releaseExecution');
	expect([
		runCard(failed, Date.now()).checksStop,
		runCard({ ...failed, attempts: 1 }, Date.now()).checksStop,
		runCard({ ...failed, reason: 'The workflow run failed' }, Date.now()).checksStop,
		runCard(failed, Date.now()).rerunnable,
		runCard({ ...failed, reason: 'signature unverified' }, Date.now()).rerunnable,
	]).toEqual([true, false, false, true, false]);
	const chosen = await api('/api/executions/checks', { id, choice: 'skip' });
	expect(text(chosen.body, 'state')).toBe('awaiting-approval');
	await world.wait(16_000);
	expect(dispatched()).toEqual([id]);
}, 60_000);

test('a check choice is refused when no check stops the release or no failed run can rerun', async () => {
	const { repository, api, sha, id } = await stopped();
	const commit = repository.commits.get(sha);
	if (commit) commit.verified = false;
	passChecks(repository, sha);
	const rerun = await api('/api/executions/checks', { id, choice: 'rerun' });
	expect([rerun.status, text(rerun.body, 'error')]).toEqual([422, 'No finished check run failed, so none can rerun']);
	if (commit) commit.verified = true;
	const nothing = await api('/api/executions/checks', { id, choice: 'skip' });
	expect([nothing.status, text(nothing.body, 'error')]).toEqual([422, 'No check stops this release']);
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const stored = decodeSync(mutableStruct({ attempts: Schema.Finite }), await storage.get(`execution:${id}`));
	await storage.put(`execution:${id}`, {
		...(await storage.get(`execution:${id}`) ?? {}),
		state: 'failed',
		attempts: stored.attempts + 1,
	});
	const ran = await api('/api/executions/checks', { id, choice: 'skip' });
	expect([ran.status, text(ran.body, 'error')]).toEqual([
		422,
		'This release already ran its workflow; retry it instead',
	]);
	await storage.put(`execution:${id}`, { ...(await storage.get(`execution:${id}`) ?? {}), state: 'ready' });
	const ready = await api('/api/executions/checks', { id, choice: 'skip' });
	expect([ready.status, text(ready.body, 'error')]).toEqual([
		422,
		'Only a release that waits on its checks or stopped on them takes this choice',
	]);
}, 60_000);

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = mutableStruct({
	default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
});
const choices: { chooseChecks(id: string, clicked: string): Effect.Effect<unknown, unknown> } = await import(
	new URL('../../src/ui/browser/checks.ts', import.meta.url).href
);

test(
	'the card of a release that the checks stop offers the choices, and the dashboard choice releases it',
	async () => {
		const { api, id } = await stopped();
		const loaded: unknown = await import(join(import.meta.dir, '../../src/components/RunCard.astro'));
		const container = await experimental_AstroContainer.create();
		const buttons = async () => {
			const [run] = await releaseExecutions(api);
			const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
				props: { run, now: Date.now() },
				request: new Request(`${origin}/runs`),
			});
			return [...html.matchAll(/name="choice" value="(\w+)"/g)].map(match => match[1]);
		};
		expect(await buttons()).toEqual(['rerun', 'skip', 'always']);
		const cookie = await world.adminCookie();
		spyOn(globalThis, 'fetch').mockImplementation(
			Object.assign(
				(input: string | URL | Request, init?: RequestInit) =>
					typeof input === 'string' && input.startsWith('/')
						? world.handle(
							new Request(new URL(input, origin), {
								...init,
								headers: { ...init?.headers, Cookie: cookie, Origin: origin },
							}),
						)
						: world.network.fetch(input, init),
				{ preconnect: fetch.preconnect },
			),
		);
		const refused = await Effect.runPromise(Effect.result(choices.chooseChecks(id, 'later')));
		expect(refused._tag).toBe('Failure');
		await Effect.runPromise(choices.chooseChecks(id, 'skip'));
		await world.wait(16_000);
		expect(dispatched()).toEqual([id]);
		expect(await buttons()).toEqual([]);
	},
	60_000,
);

test.each(
	[
		['checks failed: test', true],
		['signature unverified; test running', true],
		['commit status failure', true],
		['commit status pending', false],
		['metadata incomplete: widget (package.json) lacks license', true],
		['test running', false],
		[undefined, false],
	] as const,
)('the reason %p is a check stop: %p', (reason, expected) => {
	expect(stoppedByGates(reason)).toBe(expected);
});

test('rerun reruns every workflow run whose check failed, and refuses a run that still runs', async () => {
	const { repository, api, id } = await stopped({
		checks: [
			{ name: 'test', status: 'completed', conclusion: 'failure', runId: 7 },
			{ name: 'test', status: 'completed', conclusion: 'failure', runId: 8 },
			{ name: 'lint', status: 'completed', conclusion: 'failure', runId: 9 },
		],
		runs: [{ id: 7, status: 'completed' }, { id: 8, status: 'completed' }, { id: 9, status: 'in_progress' }],
		reason: 'checks failed: test, test, lint',
	});
	expect((await api('/api/executions/checks', { id, choice: 'rerun' })).status).toBe(200);
	expect(repository.runs.map(run => [run.id, run.attempt])).toEqual([[7, 2], [8, 2], [9, 1]]);
	expect((await audit('release.checks.rerun')).map(row => row.target)).toEqual([`${id}: 7`, `${id}: 8`]);
	const again = await api('/api/executions/checks', { id, choice: 'rerun' });
	expect([again.status, text(again.body, 'error')]).toEqual([422, 'No finished check run failed, so none can rerun']);
}, 60_000);

test('release without the check also skips running checks, and always switches off only the failed ones', async () => {
	const running: Stop = {
		checks: [
			{ name: 'test', status: 'completed', conclusion: 'failure', runId: 7 },
			{ name: 'lint', status: 'in_progress', conclusion: null, runId: 7 },
		],
		reason: 'checks failed: test; lint running',
	};
	const once = await stopped(running);
	expect((await once.api('/api/executions/checks', { id: once.id, choice: 'skip' })).status).toBe(200);
	expect((await audit('release.checks.skip')).map(row => row.target)).toEqual([`${once.id}: check test, check lint`]);
	await world.dispose();
	world = await World.create();
	const always = await stopped(running);
	expect((await always.api('/api/executions/checks', { id: always.id, choice: 'always' })).status).toBe(200);
	expect((await audit('stream.gate.skip')).map(row => row.target)).toEqual(['octo/widget:main:check test']);
	await world.dispose();
	world = await World.create();
	const pending = await stopped({
		checks: [{ name: 'lint', status: 'in_progress', conclusion: null, runId: 7 }],
		reason: 'lint running',
	});
	const refused = await pending.api('/api/executions/checks', { id: pending.id, choice: 'always' });
	expect([refused.status, text(refused.body, 'error')]).toEqual([422, 'No failed check to switch off']);
}, 60_000);

test('the gate list of a stream leaves out the checks that one release skips', async () => {
	const { repository, api, id } = await stopped({
		credentials: ['npm-token'],
		reason: 'no runtime grant for publish.yml: npm-token',
	});
	expect((await api('/api/executions/checks', { id, choice: 'skip' })).status).toBe(200);
	await world.wait(16_000);
	expect((await releaseExecutions(api))[0]?.state).toBe('awaiting-approval');
	const gates = decodeSync(
		streamGates,
		(await api('/api/repositories/gates', { repositoryId: repository.id, stream: 'main' })).body,
	);
	expect(gates.gates.find(entry => entry.gate.kind === 'check')).toEqual({
		gate: { kind: 'check', name: 'test' },
		state: 'failed',
		fact: 'failure',
	});
}, 60_000);

test('a choice on a started release whose checks pass by now restarts it', async () => {
	const { repository, api, sha, id } = await stopped();
	const [waiting] = await releaseExecutions(api);
	if (!waiting) throw new Error('Expected a releaseExecution');
	await world.coordinator(repository).enqueue({
		...waiting,
		approvedBy: 'start',
		started: { via: 'cli', actor: 'owner' },
	});
	await world.wait(16_000);
	expect((await releaseExecutions(api))[0]?.state).toBe('failed');
	passChecks(repository, sha);
	const chosen = await api('/api/executions/checks', { id, choice: 'skip' });
	expect(text(chosen.body, 'state')).toBe('awaiting-approval');
	expect(await audit('release.checks.skip')).toEqual([]);
	await world.wait(16_000);
	expect(dispatched()).toEqual([id]);
}, 60_000);

test('a started release keeps waiting while GitHub still shows the attempt before the rerun', async () => {
	const { repository, api, id } = await stopped();
	const [waiting] = await releaseExecutions(api);
	if (!waiting) throw new Error('Expected a releaseExecution');
	await world.coordinator(repository).enqueue({
		...waiting,
		approvedBy: 'start',
		started: { via: 'cli', actor: 'owner' },
	});
	await world.wait(16_000);
	expect((await releaseExecutions(api))[0]?.state).toBe('failed');
	expect((await api('/api/executions/checks', { id, choice: 'rerun' })).status).toBe(200);
	const run = repository.runs.find(entry => entry.id === 7);
	if (!run) throw new Error('Expected the CI run');
	run.attempt = 1;
	run.status = 'completed';
	await world.wait(60_000);
	expect((await releaseExecutions(api)).map(entry => [entry.state, entry.reason])).toEqual([
		['awaiting-approval', 'test running'],
	]);
	run.attempt = 2;
	await world.wait(60_000);
	expect((await releaseExecutions(api)).map(entry => [entry.state, entry.reason])).toEqual([
		['failed', 'checks failed: test'],
	]);
}, 60_000);

test('a rerun keeps the reruns GitHub accepted when a later rerun request fails', async () => {
	const { repository, api, id } = await stopped({
		checks: [
			{ name: 'test', status: 'completed', conclusion: 'failure', runId: 7 },
			{ name: 'lint', status: 'completed', conclusion: 'failure', runId: 8 },
		],
		runs: [{ id: 7, status: 'completed' }, { id: 8, status: 'completed' }],
		reason: 'checks failed: test, lint',
	});
	world.network.serve(
		'api.github.com',
		request =>
			new URL(request.url).pathname.endsWith('/actions/runs/8/rerun-failed-jobs')
				? new Response(null, { status: 500 })
				: world.github.handle(request),
	);
	expect((await api('/api/executions/checks', { id, choice: 'rerun' })).status).not.toBe(200);
	expect((await audit('release.checks.rerun')).map(row => row.target)).toEqual([`${id}: 7`]);
	const stored = decodeSync(
		mutableStruct({
			reruns: Schema.optional(mutableArray(mutableStruct({ id: Schema.Finite, attempt: Schema.Finite }))),
		}),
		await world.coordinators.instance(String(repository.id)).storage.get(`execution:${id}`),
	);
	expect(stored.reruns).toEqual([{ id: 7, attempt: 2 }]);
}, 60_000);
