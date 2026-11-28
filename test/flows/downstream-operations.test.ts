import { expect, spyOn, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { editableConfiguration, publishWorkflow } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Automation } from '@/automation/service';
import { requireReady } from '@/domain/repository';
import { decodeExecutionV1 } from '@/release/adapters/codecs/execution-v1.ts';
import { createExecution } from '@/release/domain/execution/execution.ts';

let world: World;
eachWorld(created => {
	world = created;
});

async function releaseExecution(enqueue = true, sharedPrerequisite = false) {
	const config = editableConfiguration();
	config.streams.main.workflows = {
		npm: { file: 'npm.yml', needs: sharedPrerequisite ? ['release', 'build'] : ['release'] },
		...(sharedPrerequisite ? { build: { file: 'build.yml' }, unrelated: { file: 'lint.yml' } } : {}),
		'github-release': { file: 'release.yml', needs: sharedPrerequisite ? ['npm', 'build'] : ['npm'] },
	};
	const repository = world.github.create('octo/continuations', {
		'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
		'.github/beepboop.json': JSON.stringify(config),
		'.github/workflows/publish.yml': publishWorkflow,
		'.github/workflows/build.yml': publishWorkflow,
		'.github/workflows/lint.yml': publishWorkflow,
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
			operation: 'release',
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
	const { repository, execution } = await releaseExecution();
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
	const { repository, execution, coordinator, storage } = await releaseExecution();
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
	const { coordinator, execution, repository, storage } = await releaseExecution(false);
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
	expect((await executions(repository)).map(run => run.operation).sort()).toEqual(['github-release', 'npm', 'release']);
});

test('a shared prerequisite is planned once and unrelated workflows stay out of the release', async () => {
	const { repository } = await releaseExecution(true, true);
	const planned = await executions(repository);
	expect(planned.map(run => run.operation).sort()).toEqual(['build', 'github-release', 'npm', 'release']);
	const build = planned.find(run => run.operation === 'build');
	if (!build) throw new Error('Expected shared build');
	for (const run of planned.filter(run => ['npm', 'github-release'].includes(run.operation))) {
		expect(run.dependencies).toContain(build.id);
	}
});

test('a held release uses workflow metadata from its frozen configuration commit', async () => {
	const { execution, repository, coordinator } = await releaseExecution(false);
	const stream = execution.configuration.streams.main;
	const npm = stream?.workflows.npm;
	if (!npm) throw new Error('Expected npm workflow');
	npm.file = 'new-publish.yml';
	execution.configurationSha = world.github.push(repository, {
		'.github/workflows/new-publish.yml': publishWorkflow,
	}, 'Add npm dispatch workflow').sha;
	await coordinator.enqueue(execution);
	const member = (await executions(repository)).find(run => run.operation === 'npm');
	expect(member?.sourceSha).toBe(execution.sourceSha);
	expect(member?.configurationSha).toBe(execution.configurationSha);
	expect(member?.workflow?.file).toBe(npm.file);
});

test('a new release supersedes pending members but recovering an older plan preserves newer members', async () => {
	const { execution, repository, coordinator, storage, app } = await releaseExecution(false);
	const stream = execution.configuration.streams.main;
	if (!stream) throw new Error('Expected main stream');
	stream.concurrency = 'supersede-pending';
	await coordinator.enqueue(execution);
	const first = await executions(repository);
	const stored = await world.run(app.catalog.discover(repository.name, repository.id));
	const ready = await world.run(requireReady(stored));
	const next = await world.run(createExecution(ready, {
		stream: 'main',
		operation: 'release',
		sourceSha: execution.sourceSha,
		version: '1.0.1',
		eventId: `release:1.0.1:${execution.sourceSha}`,
	}));
	next.configuration = execution.configuration;
	await coordinator.enqueue(next);
	const runs = await executions(repository);
	for (const member of first.filter(run => run.operation !== 'release')) {
		expect(runs.find(run => run.id === member.id)?.state).toBe('cancelled');
	}
	const missing = first.find(run => run.operation === 'npm');
	if (!missing) throw new Error('Expected older npm execution');
	await storage.delete(`execution:${missing.id}`);
	await storage.put(`execution:${execution.id}`, { ...execution, state: 'succeeded' });
	await coordinator.recover(execution.id, 'reconcile', 'admin');
	const recovered = await executions(repository);
	expect(recovered.some(run => run.id === missing.id)).toBe(true);
	expect(recovered.filter(run => run.eventId === next.eventId && run.operation !== 'release').map(run => run.state))
		.toEqual(['ready', 'ready']);
});
