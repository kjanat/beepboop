import { expect, spyOn, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { editableConfiguration, publishWorkflow } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Automation } from '@/automation/service';
import { requireReady } from '@/domain/repository';
import { decodeExecutionV1 } from '@/release/domain/execution/codec-v1.ts';
import { createExecution } from '@/release/domain/execution/execution.ts';

let world: World;
eachWorld(created => {
	world = created;
});

async function promotion(enqueue = true) {
	const config = editableConfiguration();
	config.streams.main.workflows = {
		npm: { file: 'npm.yml', needs: ['promote'] },
		'github-release': { file: 'release.yml', needs: ['npm'] },
	};
	const repository = world.github.create('octo/continuations', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
		'.github/beepboop.json': JSON.stringify(config),
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/npm.yml': publishWorkflow,
		'.github/workflows/release.yml': publishWorkflow,
	});
	world.npm.publish('widget', '1.0.0');
	const app = await world.run(Automation);
	const stored = await world.run(app.catalog.discover(repository.name, repository.id));
	const ready = await world.run(requireReady(stored));
	const execution = await world.run(
		createExecution(ready, {
			stream: 'main',
			operation: 'promote',
			eventId: `release:1.0.0:${stored.sha}`,
			sourceSha: stored.sha,
			version: '1.0.0',
		}),
	);
	execution.state = 'running';
	execution.runId = 9001;
	execution.runAttempt = 1;
	repository.runs.push({
		id: 9001,
		path: '.github/workflows/publish.yml',
		event: 'workflow_dispatch',
		headSha: stored.sha,
		headBranch: 'main',
		status: 'completed',
		conclusion: 'success',
		attempt: 1,
		title: 'Check',
		inputs: {},
	});
	const coordinator = world.coordinator(repository);
	if (enqueue) await coordinator.enqueue(execution);
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

test('a completed release dispatches its dependent workflow', async () => {
	const { repository, execution } = await promotion();
	await world.wait(20_000);
	const child = (await executions(repository)).find(run => run.operation === 'npm');
	if (!child) throw new Error('Expected npm execution');
	expect(child?.eventId).toBe(execution.eventId);
	expect(child?.sourceSha).toBe(execution.sourceSha);
	expect(child?.version).toBe(execution.version);
	expect(repository.runs.some(run => run.path.endsWith('release.yml'))).toBe(false);
	await world.wait(20_000);
	const npmRun = repository.runs.find(run => run.path.endsWith('npm.yml'));
	if (!npmRun) throw new Error('Expected npm dispatch');
	npmRun.status = 'completed';
	npmRun.conclusion = 'success';
	await world.wait(60_000);
	const release = (await executions(repository)).find(run => run.operation === 'github-release');
	expect(repository.runs.some(run => run.path.endsWith('release.yml'))).toBe(true);
	expect(release?.dependencies).toEqual([child?.id]);
	expect(release?.sourceSha).toBe(execution.sourceSha);
	expect(release?.version).toBe(execution.version);
});

test('an old release creates its missing continuation only on targeted recovery', async () => {
	const { repository, execution, coordinator, storage } = await promotion();
	const initial = await executions(repository);
	const npm = initial.find(run => run.operation === 'npm');
	const github = initial.find(run => run.operation === 'github-release');
	if (!npm || !github) throw new Error('Expected planned executions');
	await storage.delete(`execution:${github.id}`);
	await storage.put(`execution:${npm.id}`, { ...npm, state: 'succeeded' });
	await storage.put(`execution:${execution.id}`, { ...execution, state: 'succeeded' });
	await world.wait(20_000);
	expect(await executions(repository)).toHaveLength(2);
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	const repaired = await executions(repository);
	expect(repaired).toHaveLength(3);
	expect(repaired.find(run => run.id === npm.id)?.state).toBe('succeeded');
	expect(repaired.find(run => run.id === github.id)?.dependencies).toEqual([npm.id]);
});

test('an interrupted plan leaves no runnable operations and can be retried', async () => {
	const { coordinator, execution, repository, storage } = await promotion(false);
	const put = storage.put.bind(storage);
	const failure = spyOn(storage, 'put').mockImplementation(async (key, value) => {
		if (typeof key === 'string') return put(key, value);
		if (Object.keys(key).includes(`execution:${execution.id}`)) throw new Error('Interrupted plan write');
		return put(key);
	});
	await expect(coordinator.enqueue(execution)).rejects.toThrow();
	failure.mockRestore();
	expect(await executions(repository)).toHaveLength(0);
	await coordinator.enqueue(execution);
	expect((await executions(repository)).map(run => run.operation).sort()).toEqual(['github-release', 'npm', 'promote']);
});
