import { expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { Repository } from '@root/test/support/github.ts';
import type { Api } from '@root/test/support/http.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { promotions } from '@root/test/support/releases.ts';
import { npmManifest, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
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

async function stopped(): Promise<{ repository: Repository; api: Api; sha: string; id: string }> {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					required: ['pkg:npm/widget'],
					prepare: { strategy: 'managed' },
					promote: { approval: 'push', workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] } },
				},
			},
		}),
	}, 'Configure releases');
	passChecks(repository, world.github.head(repository));
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const raised = world.github.push(repository, { 'package.json': npmManifest('widget', '1.1.0') }, 'Release 1.1.0');
	repository.checks.set(raised.sha, [{ name: 'test', status: 'completed', conclusion: 'failure', runId: 7 }]);
	repository.runs.push({
		id: 7,
		path: '.github/workflows/ci.yml',
		event: 'push',
		headSha: raised.sha,
		headBranch: repository.defaultBranch,
		status: 'completed',
		conclusion: 'failure',
		attempt: 1,
		title: 'Release 1.1.0',
		inputs: {},
	});
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const [waiting] = await promotions(api);
	expect([waiting?.state, waiting?.reason]).toEqual(['awaiting-approval', 'checks failed: test']);
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
	const [skip] = await audit('promotion.checks.skip');
	expect(skip?.target).toBe(`${id}: check test`);
	expect((await audit('promotion.approve')).map(row => row.target)).toEqual([
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
	expect((await audit('promotion.checks.rerun')).map(row => row.target)).toEqual([`${id}: 7`]);
	repository.checks.set(sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 7 }]);
	await world.wait(16_000);
	expect((await promotions(api))[0]?.reason).toBe('test running');
	expect(dispatched()).toEqual([]);
	passChecks(repository, sha);
	await world.wait(60_000);
	expect(dispatched()).toEqual([id]);
}, 60_000);

test('a started release that stopped on its checks waits again after a choice', async () => {
	const { repository, api, id } = await stopped();
	const [waiting] = await promotions(api);
	if (!waiting) throw new Error('Expected a promotion');
	await world.coordinator(repository).enqueue({
		...waiting,
		approvedBy: 'start',
		started: { via: 'cli', actor: 'owner' },
	});
	await world.wait(16_000);
	const [failed] = await promotions(api);
	expect([failed?.state, failed?.reason]).toEqual(['failed', 'checks failed: test']);
	if (!failed) throw new Error('Expected a promotion');
	expect([
		runCard(failed, Date.now()).checksStop,
		runCard({ ...failed, attempts: 1 }, Date.now()).checksStop,
		runCard({ ...failed, reason: 'The workflow run failed' }, Date.now()).checksStop,
	]).toEqual([true, false, false]);
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
	expect([rerun.status, text(rerun.body, 'error')]).toEqual([422, 'No failed check run to rerun']);
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
			const [run] = await promotions(api);
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
