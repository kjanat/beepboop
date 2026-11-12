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
