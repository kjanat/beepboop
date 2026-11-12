import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize, runAction, runRuntime } from '@root/test/support/actions.ts';
import { bearer } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { only } from '@root/test/support/releases.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { RepositoryGateway } from '@/automation/github';
import { pullSchema } from '@/automation/github-resources';

let world: World;
eachWorld(created => {
	world = created;
});

test('PR creation succeeds with a stale response head while all later GitHub reads fail', async () => {
	const repository = widget(world.github);
	const background: Promise<void>[] = [];
	const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID), fetch, work => background.push(work));
	const snapshot = await Effect.runPromise(gateway.snapshot(repository.name, repository.id));
	let created = false;
	const after: string[] = [];
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		if (created) {
			after.push(`${request.method} ${path}`);
			return Response.json({ message: 'Unavailable after accepted write' }, { status: 403 });
		}
		const response = await world.github.handle(request);
		if (request.method === 'POST' && path === `/repos/${repository.name}/pulls`) {
			created = true;
			const pull = pullSchema.parse(await response.json());
			return Response.json({ ...pull, head: { ...pull.head, sha: snapshot.sha } }, { status: 201 });
		}
		return response;
	});
	const result = await Effect.runPromise(gateway.pullRequest(snapshot, 'release/test', 'Release', '', [{
		path: 'package.json',
		before: snapshot.files['package.json'] ?? '',
		after: '{"name":"widget","version":"1.1.0"}\n',
	}]));
	expect(result.url).toBe(`https://github.com/${repository.name}/pull/1`);
	expect(result.head).toEqual(one(repository.pulls, 'created PR').head.sha);
	await Promise.all(background);
	expect(after).toEqual([`GET /repos/${repository.name}/labels`]);
});

test('large begin contexts travel through a file and the packed prepare process can start', async () => {
	const before = `${JSON.stringify({ name: 'widget', version: '1.0.0', description: 'x'.repeat(300_000) })}\n`;
	const after = before.replace('1.0.0', '1.1.0');
	const checkout = materialize({ 'package.json': before });
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-large-context-'));
	try {
		const repository = widget(world.github);
		world.network.serve(new URL(origin).host, () => Response.json({
			id: 'large',
			repositoryId: repository.id,
			repository: repository.name,
			operation: 'prepare',
			stream: 'main',
			state: 'running',
			sourceSha: checkout.sha,
			version: '1.1.0',
			plan: { edits: [{ path: 'package.json', before, after }], lockfiles: [] },
			prepared: { edits: [{ path: 'Cargo.lock', before: 'x'.repeat(300_000), after: 'y'.repeat(300_000) }] },
		}));
		const begun = await runAction(
			world,
			'begin',
			{ repository, runId: 1, sha: checkout.sha, file: 'prepare.yml' },
			{ EXECUTION_ID: 'large' },
		);
		const context = JSON.parse(begun.outputs.context ?? '{}');
		expect(begun.outputs.context?.length).toBeLessThan(2_000);
		expect(context.plan).toBeUndefined();
		expect(context.prepared).toBeUndefined();
		expect(begun.context?.length).toBeGreaterThan(1_000_000);
		const contextFile = join(scratch, 'context.json');
		writeFileSync(contextFile, begun.context ?? '{}');
		await runRuntime('prepare', {
			RELEASE_CONTEXT: JSON.stringify({ ...context, contextFile }),
			PREPARATION_MODE: 'apply',
			GITHUB_WORKSPACE: checkout.dir,
		});
		expect(await Bun.file(join(checkout.dir, 'package.json')).text()).toBe(after);
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
});

test('publishing a GitHub release succeeds when later release and tag reads are unavailable', async () => {
	let published = false;
	const confirmations: string[] = [];
	const { promotionId, refsCompletion } = await packedRelease(
		world,
		async () => {
			world.network.serve('api.github.com', async request => {
				const path = new URL(request.url).pathname;
				if (published && request.method === 'GET' && /\/(?:releases|git\/ref\/tags|git\/tags)\//.test(path)) {
					confirmations.push(path);
					return Response.json({ message: 'Unavailable after publication' }, { status: 403 });
				}
				const response = await world.github.handle(request);
				if (request.method === 'PATCH' && /\/releases\/\d+$/.test(path) && response.ok) published = true;
				return response;
			});
		},
		undefined,
		true,
	);
	const result = await only(bearer(world, await world.cliSession()), 'promote');
	expect(result.id).toBe(promotionId);
	expect(result.state).toBe('succeeded');
	expect(published).toBe(true);
	expect(confirmations).toEqual([]);
	expect(refsCompletion.filter(call => /\/(?:git\/ref|git\/tags)|graphql/.test(call.url))).toEqual([]);
}, 30_000);

for (const outcome of [429, 422, 'reset', 204] as const) {
	test(`dispatch recovery distinguishes ${outcome} from an accepted write`, async () => {
		const { discoveredWidget } = await import('@root/test/support/client.ts');
		const { prepareRelease, approvePromotion } = await import('@root/test/support/releases.ts');
		const { passChecks } = await import('@root/test/support/repositories.ts');
		const session = await world.cliSession();
		const repository = await discoveredWidget(world, session);
		const api = bearer(world, session);
		await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
		await world.wait(20_000);
		const merged = world.github.merge(repository, one(repository.pulls, 'preparation PR').number);
		passChecks(repository, merged.sha);
		await world.push(repository);
		await world.wait(1_000);
		let requests = 0;
		world.network.serve('api.github.com', request => {
			if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/dispatches')) {
				requests++;
				if (requests === 1) {
					if (outcome === 'reset') throw new Error('ECONNRESET');
					if (outcome === 204) return new Response(null, { status: 204 });
					return Response.json(
						{ message: 'Dispatch rejected' },
						{ status: outcome, headers: { 'Retry-After': '120' } },
					);
				}
			}
			return world.github.handle(request);
		});
		await approvePromotion(api, merged.sha);
		await world.wait(16_000);
		expect(requests).toBe(1);
		const first = await only(api, 'promote');
		expect(first.state).toBe(outcome === 429 ? 'ready' : outcome === 422 ? 'failed' : 'dispatching');
		await world.wait(61_000);
		expect(requests).toBe(1);
		await world.wait(121_000);
		expect(requests).toBe(outcome === 429 ? 2 : 1);
		expect((await only(api, 'promote')).state).toBe(
			outcome === 429 ? 'running' : outcome === 422 ? 'failed' : 'uncertain',
		);
	});
}

test('a pending manual WinGet receipt is recovered without creating another PR', async () => {
	const { Store } = await import('@/automation/store');
	const { WinGetService } = await import('@/automation/winget');
	const plan = {
		id: 'receipt',
		repositoryId: 42,
		repository: 'octo/widget',
		releaseId: 10,
		tag: 'v1.1.0',
		version: '1.1.0',
		packageIdentifier: 'Octo.Widget',
		sourceSha: 'a'.repeat(40),
		configurationSha: 'b'.repeat(40),
		files: {},
		digest: 'c'.repeat(64),
		releaseUrl: 'https://github.com/octo/widget/releases/tag/v1.1.0',
	};
	await world.db.prepare('INSERT INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)')
		.bind(
			plan.id,
			plan.packageIdentifier,
			plan.version,
			JSON.stringify({ plan, state: 'pending', updatedAt: Date.now() }),
			Date.now(),
		).run();
	const calls: string[] = [];
	world.network.serve('api.github.com', request => {
		calls.push(`${request.method} ${request.url}`);
		const url = new URL(request.url);
		if (request.method === 'GET' && url.pathname === '/repos/microsoft/winget-pkgs/pulls') {
			expect(url.searchParams.get('head')).toBe('octo:winget/Octo.Widget/1.1.0/cccccccccccccccc');
			return Response.json([{
				number: 123,
				html_url: 'https://github.com/microsoft/winget-pkgs/pull/123',
				head: { sha: 'd'.repeat(40) },
				state: 'open',
				merged_at: null,
			}]);
		}
		return Response.json({ message: 'Unexpected request' }, { status: 403 });
	});
	const service = new WinGetService(new Store(world.db), new RepositoryGateway(world.env, 42), {
		WINGET_GITHUB_TOKEN: 'test-token',
		WINGET_FORK: 'octo/winget-pkgs',
	});
	await Effect.runPromise(service.reconcile());
	expect(await Effect.runPromise(service.get(plan.id))).toMatchObject({
		state: 'open',
		number: 123,
		url: 'https://github.com/microsoft/winget-pkgs/pull/123',
	});
	expect(calls).toHaveLength(1);
});

for (const when of ['before update', 'during update'] as const) {
	test(`a preparation PR retargeted ${when} is rejected without metadata updates`, async () => {
		const repository = widget(world.github);
		const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID));
		const snapshot = await Effect.runPromise(gateway.snapshot(repository.name, repository.id));
		const created = await Effect.runPromise(gateway.pullRequest(snapshot, 'release/base', 'Release', '', [{
			path: 'package.json',
			before: snapshot.files['package.json'] ?? '',
			after: '{"name":"widget","version":"1.1.0"}\n',
		}]));
		const stored = one(repository.pulls, 'created PR');
		if (when === 'before update') stored.base = 'maintenance';
		world.network.serve('api.github.com', request => {
			if (
				when === 'during update' && request.method === 'PATCH'
				&& new URL(request.url).pathname.endsWith(`/pulls/${stored.number}`)
			) {
				stored.base = 'maintenance';
			}
			return world.github.handle(request);
		});
		const mark = world.network.mark();
		const result = await Effect.runPromise(
			Effect.result(gateway.refreshPullRequest(snapshot, 'release/base', 'Updated', '', created.head)),
		);
		expect(result._tag === 'Failure' && result.failure.message).toBe(
			`The preparation PR #${stored.number} targets maintenance; retarget it to ${repository.defaultBranch} to continue this release.`,
		);
		expect(world.network.since(mark).filter(call => /\/labels|\/assignees|\/requested_reviewers/.test(call.url)))
			.toEqual([]);
		if (when === 'before update') expect(stored.title).toBe('Release');
	});
}
