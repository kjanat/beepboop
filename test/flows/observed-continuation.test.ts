import { expect, spyOn, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { editableConfiguration, publishWorkflow } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { createExecution } from '@/automation/execution';
import { Automation } from '@/automation/service';
import { requireReady } from '@/domain/repository';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

let world: World;
eachWorld(created => {
	world = created;
});

async function observed(count = 1) {
	const config = editableConfiguration();
	config.streams.main.workflows = {
		check: { file: 'check.yml', mode: 'observe' },
		...Object.fromEntries(
			Array.from({ length: count }, (_, i) => [`follow${i}`, { file: 'follow.yml', needs: ['check'] }]),
		),
	};
	const repository = world.github.create('octo/continuations', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
		'.github/beepboop.json': JSON.stringify(config),
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/check.yml':
			'on: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n',
		'.github/workflows/follow.yml': publishWorkflow,
	});
	world.npm.publish('widget', '1.0.0');
	const app = await world.run(Automation);
	const stored = await world.run(app.discover(repository.name, repository.id));
	const ready = await world.run(requireReady(stored));
	const execution = await world.run(
		createExecution(ready, {
			stream: 'main',
			operation: 'check',
			eventId: 'observed:9001',
			sourceSha: stored.sha,
			observed: true,
		}),
	);
	execution.state = 'running';
	execution.runId = 9001;
	execution.runAttempt = 1;
	repository.runs.push({
		id: 9001,
		path: '.github/workflows/check.yml',
		event: 'push',
		headSha: stored.sha,
		headBranch: 'main',
		status: 'completed',
		conclusion: 'success',
		attempt: 1,
		title: 'Check',
		inputs: {},
	});
	const coordinator = world.coordinator(repository);
	await coordinator.enqueue(execution);
	return {
		repository,
		app,
		execution,
		coordinator,
		storage: world.coordinators.instance(String(repository.id)).storage,
	};
}

async function executions(repository: Repository) {
	return (await world.coordinator(repository).exportJournal()).filter(entry => entry.key.startsWith('execution:')).map(
		entry => decodeExecutionV1(entry.value),
	);
}

for (const children of [1, 70]) {
	test(`completion and ${children} continuations survive a failed atomic commit`, async () => {
		const { repository, execution, coordinator, storage } = await observed(children);
		const put = storage.put.bind(storage);
		let fail = true;
		let failures = 0;
		spyOn(storage, 'put').mockImplementation(async (key, value) => {
			if (
				fail && typeof key === 'object'
				&& Object.values(key).some(value =>
					typeof value === 'object' && value !== null && 'operation' in value
					&& value.operation === `follow${children - 1}`
				)
			) {
				failures++;
				throw new Error('Interrupted dependent commit');
			}
			if (typeof key === 'string') await put(key, value);
			else await put(key);
		});
		await world.wait(20_000);
		expect(failures).toBeGreaterThan(0);
		const interrupted = await executions(repository);
		expect(interrupted).toHaveLength(1);
		expect(interrupted[0]?.state).toBe('running');
		fail = false;
		await world.wait(120_000);
		const recovered = await executions(repository);
		expect(recovered.find(item => item.id === execution.id)?.state).toBe('succeeded');
		expect(recovered.filter(item => item.operation.startsWith('follow'))).toHaveLength(children);
		await coordinator.recover(execution.id, 'reconcile', 'admin');
		await world.wait(2_000);
		expect(await executions(repository)).toHaveLength(children + 1);
	});
}

test('reconciliation repairs a legacy success with missing continuations', async () => {
	const { repository, execution, coordinator, storage } = await observed();
	await storage.put(`execution:${execution.id}`, { ...execution, state: 'succeeded' });
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await world.wait(2_000);
	expect((await executions(repository)).filter(item => item.operation === 'follow0')).toHaveLength(1);
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await world.wait(2_000);
	expect(await executions(repository)).toHaveLength(2);
});

test('reconciliation restores a missing sibling while preserving a completed child', async () => {
	const { repository, execution, coordinator, storage } = await observed(2);
	await world.wait(20_000);
	const children = await executions(repository);
	const progressed = children.find(child => child.operation === 'follow0');
	const missing = children.find(child => child.operation === 'follow1');
	if (!progressed || !missing) throw new Error('Expected both continuations');
	const completed = { ...progressed, state: 'succeeded', runId: 9010, runAttempt: 3 };
	await storage.put(`execution:${progressed.id}`, completed);
	await storage.delete(`execution:${missing.id}`);
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await world.wait(2_000);
	const recovered = await executions(repository);
	expect(recovered.find(child => child.id === missing.id)).toMatchObject({ operation: 'follow1' });
	expect(recovered.find(child => child.id === progressed.id)).toMatchObject({
		state: completed.state,
		runId: completed.runId,
		runAttempt: completed.runAttempt,
	});
});

test('stale coordinator access cannot resume work while the repository is suspended', async () => {
	const { repository, app, execution, storage } = await observed();
	await storage.put('access', { suspended: false });
	await world.run(app.setAccess(repository.id, { kind: 'suspended', since: Date.now() }));
	await world.wait(120_000);
	expect((await executions(repository)).find(item => item.id === execution.id)?.state).toBe('running');
	expect(world.github.dispatches).toHaveLength(0);
	await world.run(app.setAccess(repository.id, { kind: 'active' }));
	await world.wait(2_000);
	expect((await executions(repository)).find(item => item.id === execution.id)?.state).toBe('succeeded');
});

test('an access read failure leaves work retryable and fails closed', async () => {
	const { repository, execution } = await observed();
	const execute = world.db.execute.bind(world.db);
	let unavailable = true;
	spyOn(world.db, 'execute').mockImplementation((query, values) => {
		if (unavailable && query.startsWith('SELECT id, name, access, suspended_at')) throw new Error('D1 unavailable');
		return execute(query, values);
	});
	await expect(world.wait(20_000)).rejects.toThrow();
	expect((await executions(repository)).find(item => item.id === execution.id)?.state).toBe('running');
	expect(world.github.dispatches).toHaveLength(0);
	unavailable = false;
	await world.wait(120_000);
	expect((await executions(repository)).find(item => item.id === execution.id)?.state).toBe('succeeded');
});

test('suspension during reconciliation prevents subsequent executions from advancing', async () => {
	const { repository, app, execution, coordinator } = await observed();
	const stored = await world.run(app.store.repository(repository.id));
	if (!stored) throw new Error('Expected repository');
	const ready = await world.run(requireReady(stored));
	const next = await world.run(
		createExecution(
			{
				...ready,
				configuration: {
					...ready.configuration,
					streams: { ...ready.configuration.streams, second: ready.configuration.streams.main! },
				},
			},
			{ stream: 'second', operation: 'follow0', eventId: 'second', sourceSha: stored.sha },
		),
	);
	next.state = 'ready';
	next.createdAt = execution.createdAt + 1;
	await coordinator.enqueue(next);
	const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
	world.network.serve('api.github.com', async request => {
		if (new URL(request.url).pathname.endsWith('/actions/runs/9001')) {
			entered.resolve();
			await resume.promise;
		}
		return world.github.handle(request);
	});
	const pass = world.wait(20_000);
	await entered.promise;
	try {
		await world.run(app.store.setAccess(repository.id, { kind: 'suspended', since: Date.now() }));
	} finally {
		resume.resolve();
	}
	await pass;
	expect(world.github.dispatches).toHaveLength(0);
	expect((await executions(repository)).find(item => item.id === next.id)?.state).toBe('ready');
	await world.run(app.setAccess(repository.id, { kind: 'active' }));
	await world.wait(2_000);
	expect(world.github.dispatches.length).toBeGreaterThan(0);
});

test('legacy continuation repair requires current inventory and can recover after discovery is restored', async () => {
	const { repository, app, execution, coordinator, storage } = await observed();
	await storage.put(`execution:${execution.id}`, { ...execution, state: 'succeeded' });
	const record = await world.run(app.store.repository(repository.id));
	if (!record) throw new Error('Expected repository');
	await world.run(
		app.store.saveDiscovery({
			...record,
			sha: 'b'.repeat(40),
			inventory: {
				...record.inventory,
				workflows: record.inventory.workflows.filter(workflow => workflow.file !== 'follow.yml'),
			},
		}),
	);
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await world.wait(2_000);
	expect(await executions(repository)).toHaveLength(1);
	expect(await storage.get(`quarantine:${execution.id}`)).toMatchObject({
		error: expect.stringContaining('Workflow needs workflow_dispatch'),
	});
	await world.run(app.store.saveDiscovery(record));
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await world.wait(2_000);
	expect((await executions(repository)).find(item => item.operation === 'follow0')).toMatchObject({
		sourceSha: execution.sourceSha,
		configurationSha: execution.configurationSha,
	});
	expect(await storage.get(`quarantine:${execution.id}`)).toBeUndefined();
});

test('settled history uses no per-execution D1 access budget before newer active work', async () => {
	const { repository, execution, storage } = await observed();
	const { runId: _runId, runAttempt: _runAttempt, workflowSha: _workflowSha, ...unstarted } = execution;
	for (let i = 0; i < 1200; i++) {
		await storage.put(`execution:history-${i}`, {
			...unstarted,
			id: `history-${i}`,
			eventId: `history-${i}`,
			state: i % 3 === 0 ? 'cancelled' : i % 3 === 1 ? 'failed' : 'succeeded',
			version: undefined,
			createdAt: execution.createdAt - i - 1,
		});
	}
	const execute = world.db.execute.bind(world.db);
	let accessReads = 0;
	spyOn(world.db, 'execute').mockImplementation((query, values) => {
		if (query.startsWith('SELECT id, name, access, suspended_at') && ++accessReads > 20) {
			throw new Error('Access-query budget exhausted');
		}
		return execute(query, values);
	});
	await world.wait(20_000);
	expect((await executions(repository)).find(run => run.id === execution.id)?.state).toBe('succeeded');
	expect((await executions(repository)).filter(run => run.eventId === execution.eventId && run.operation === 'follow0'))
		.toHaveLength(1);
	expect(accessReads).toBeLessThan(20);
	const before = accessReads;
	await world.wait(20_000);
	expect(accessReads - before).toBeLessThan(20);
});
