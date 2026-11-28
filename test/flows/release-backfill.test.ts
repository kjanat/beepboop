import { expect, test } from 'bun:test';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import { call, cliTransport } from '@root/test/support/client.ts';
import { bearer } from '@root/test/support/http.ts';
import { withIdentity, workflowCall } from '@root/test/support/ledger.ts';
import { npmManifest, publishWorkflow, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { Automation } from '@/automation/service';
import { routes } from '@/contract/routes';
import { requireReady } from '@/domain/repository';
import { createExecution } from '@/release/domain/execution/execution.ts';

let world: World;
eachWorld(created => {
	world = created;
});

test('an opted-in backfill dispatches current workflow code for a published historical commit', async () => {
	const repository = widget(world.github);
	const commit = world.github.head(repository);
	const backfill = { file: 'backfill.yml', mode: 'dispatch', ref: 'refs/heads/main', publications: ['pkg:npm/widget'] };
	const current = world.github.push(repository, {
		'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
		'packages/widget/package.json': npmManifest('widget', '1.1.0'),
		'.github/workflows/backfill.yml': publishWorkflow.replace('operation: release', 'operation: backfill'),
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					release: { workflow: { file: 'publish.yml' } },
					workflows: {
						backfill: { ...backfill, backfill: true },
						recovery: { ...backfill, backfill: true },
						unrelated: backfill,
					},
				},
			},
		}),
	}, 'Configure recovery');
	const token = await world.cliSession();
	const transport = cliTransport(world, token);
	await call(routes.repositoriesDiscover, { repository: repository.name }, transport);
	const parent = await world.run(Effect.gen(function*() {
		const service = yield* Automation;
		const ready = yield* requireReady(yield* service.catalog.refresh(repository.name, repository.id));
		const execution = yield* createExecution(ready, {
			stream: 'main',
			operation: 'release',
			eventId: 'releaseExecution',
			sourceSha: commit,
			version: '1.0.0',
		});
		return yield* service.coordinators.enqueue(repository.id, {
			...execution,
			state: 'failed',
			release: {
				id: 'github:published',
				repository: { id: repository.id, name: repository.name },
				stream: 'main',
				commit,
				version: '1.0.0',
				tag: 'v1.0.0',
				releaseId: 999,
				artifacts: [],
				publications: [],
			},
		});
	}));
	repository.releases.push({
		id: 999,
		tag: 'v1.0.0',
		target: commit,
		draft: false,
		prerelease: false,
		authorId: 1,
		body: '',
	});
	world.github.recordTag(repository, 'v1.0.0', 'f'.repeat(40), current.sha, true);
	const api = bearer(world, token);
	const request = { id: parent.id, repositoryId: repository.id, operation: 'backfill' };
	expect((await api(routes.executionsBackfill.path, request)).status).toBe(422);
	expect((await api(routes.executionsBackfill.path, { ...request, operation: 'unrelated' })).status).toBe(422);
	world.github.recordTag(repository, 'v1.0.0', 'e'.repeat(40), commit, true);
	const queued = await call(routes.executionsBackfill, { ...request, operation: 'recovery' }, transport);
	world.github.recordTag(repository, 'v1.0.0', 'f'.repeat(40), current.sha, true);
	await world.wait(16_000);
	expect(await world.coordinator(repository).execution(queued.id)).toMatchObject({
		state: 'failed',
		reason: 'Release tag v1.0.0 no longer points to the backfill commit',
	});
	expect(repository.runs.some(run => run.inputs.beepboop_execution_id === queued.id)).toBe(false);
	world.github.recordTag(repository, 'v1.0.0', 'e'.repeat(40), commit, true);
	const started = await call(routes.executionsBackfill, request, transport);
	expect(started.sourceSha).toBe(commit);
	expect((await call(routes.executionsBackfill, request, transport)).id).toBe(started.id);
	await world.wait(16_000);
	const runs = repository.runs.filter(run => run.inputs.beepboop_execution_id === started.id);
	expect(runs).toHaveLength(1);
	const run = runs[0];
	if (!run) throw new Error('Expected backfill dispatch');
	expect(run.headSha).toBe(current.sha);
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'backfill.yml');
	const result = await begin(world, identity, started.id, 'main', 'backfill');
	expect(JSON.parse(result.outputs.context ?? '{}')).toMatchObject({
		sourceSha: commit,
		upstreamRelease: { tag: 'v1.0.0', commit },
	});
	const next = await withIdentity(
		world,
		identity,
		() => Effect.runPromise(workflowCall(world, '/api/workflow/publish/next', { executionId: started.id })),
	);
	expect(next).toMatchObject({ kind: 'publish', package: { manifest: 'package.json' } });
	world.npm.publish('widget', '1.0.0');
	await runAction(world, 'report', identity, {
		EXECUTION_ID: started.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.0', outcome: 'succeeded' },
		]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(16_000);
	expect((await world.coordinator(repository).execution(started.id))?.state).toBe('succeeded');
});
