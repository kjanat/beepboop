import { expect, test } from 'bun:test';
import { ownerId } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { Store } from '@/automation/store';
import { requireReady } from '@/domain/repository';
import { createExecution, expectedRunTitle } from '@/release/domain/execution/execution.ts';

let world: World;
eachWorld(created => {
	world = created;
});

async function fixture(state: 'running' | 'blocked' | 'verifying' | 'failed' | 'cancelled' = 'running') {
	const repository = widget(world.github);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const record = await Effect.runPromise(new Store(world.db).repositories.get(repository.id));
	if (!record) throw new Error('Repository missing');
	const ready = await world.run(requireReady(record));
	const source = world.github.head(repository);
	const execution = await world.run(createExecution(ready, {
		stream: 'main',
		operation: 'release',
		eventId: 'cancel',
		sourceSha: source,
		version: '1.0.0',
	}));
	const coordinator = world.coordinator(repository);
	repository.runs.push({
		id: 123,
		path: '.github/workflows/publish.yml',
		event: 'workflow_dispatch',
		headSha: source,
		headBranch: repository.defaultBranch,
		status: 'in_progress',
		conclusion: null,
		attempt: 1,
		title: expectedRunTitle(execution),
		inputs: { beepboop_execution_id: execution.id },
	});
	const run = repository.runs.find(run => run.id === 123);
	if (!run) throw new Error('Workflow run missing');
	await coordinator.enqueue({
		...execution,
		state,
		attempts: 1,
		runId: run.id,
		runAttempt: 1,
		workflowSha: source,
	});
	const cancellations: string[] = [];
	world.network.serve('api.github.com', request => {
		if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/cancel')) cancellations.push(request.url);
		return world.github.handle(request);
	});
	return { repository, coordinator, execution, run, cancellations };
}

for (const state of ['running', 'blocked', 'verifying', 'failed'] as const) {
	test(`cancellation refuses an already successful workflow while the operation is ${state}`, async () => {
		const { coordinator, execution, run, cancellations } = await fixture(state);
		run.status = 'completed';
		run.conclusion = 'success';
		await expect(coordinator.cancel(execution.id, String(ownerId))).rejects.toThrow('already completed successfully');
		expect((await coordinator.execution(execution.id))?.state).toBe(state);
		expect(cancellations).toEqual([]);
		expect(run.conclusion).toBe('success');
	});
}

test('cancellation still stops an active bound workflow', async () => {
	const { coordinator, execution, run, cancellations } = await fixture();
	const cancelled = await coordinator.cancel(execution.id, String(ownerId));
	expect(cancelled.state).toBe('cancelled');
	expect(run.conclusion).toBe('cancelled');
	expect(cancellations).toHaveLength(1);
});

test('a completed failed workflow can still be cancelled to stop release recovery', async () => {
	const { coordinator, execution, run, cancellations } = await fixture();
	run.status = 'completed';
	run.conclusion = 'failure';
	const cancelled = await coordinator.cancel(execution.id, String(ownerId));
	expect(cancelled.state).toBe('cancelled');
	expect(cancellations).toEqual([]);
	expect(run.conclusion).toBe('failure');
});

test('a GitHub-cancelled run can be cancelled to stop recovery, and an operator cancellation only once', async () => {
	const { coordinator, execution, run, cancellations } = await fixture('cancelled');
	run.status = 'completed';
	run.conclusion = 'cancelled';
	const cancelled = await coordinator.cancel(execution.id, String(ownerId));
	expect([cancelled.state, cancelled.cancelledBy]).toEqual(['cancelled', String(ownerId)]);
	expect(cancellations).toEqual([]);
	await expect(coordinator.cancel(execution.id, String(ownerId))).rejects.toThrow('Execution has already finished');
});

test('an accepted cancellation survives failure to reread the workflow run', async () => {
	const { coordinator, execution, run } = await fixture();
	let accepted = false;
	world.network.serve('api.github.com', request => {
		const path = new URL(request.url).pathname;
		if (request.method === 'POST' && path.endsWith('/cancel')) {
			accepted = true;
			return world.github.handle(request);
		}
		if (accepted && path.endsWith(`/actions/runs/${run.id}`)) {
			return Response.json({ message: 'Read unavailable' }, { status: 403 });
		}
		return world.github.handle(request);
	});
	const cancelled = await coordinator.cancel(execution.id, String(ownerId));
	expect(cancelled.state).toBe('cancelled');
	expect(run.conclusion).toBe('cancelled');
});

for (const status of [202, 409]) {
	test(`successful workflow completion racing a ${status} cancellation response preserves the operation`, async () => {
		const { coordinator, execution, run } = await fixture();
		world.network.serve('api.github.com', request => {
			if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/cancel')) {
				run.status = 'completed';
				run.conclusion = 'success';
				return Response.json({ message: 'Workflow completed' }, { status });
			}
			return world.github.handle(request);
		});
		await expect(coordinator.cancel(execution.id, String(ownerId))).rejects.toThrow('already completed successfully');
		expect((await coordinator.execution(execution.id))?.state).toBe('running');
		expect(run.conclusion).toBe('success');
	});
}
