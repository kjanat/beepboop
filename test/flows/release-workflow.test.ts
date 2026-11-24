import { expect, test } from 'bun:test';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client.ts';
import type { Repository, Run } from '@root/test/support/github.ts';
import { dispatchedPublishWorkflow, passChecks } from '@root/test/support/repositories.ts';
import type { WorkflowRecord } from '@root/test/support/workflows.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import { routes } from '@/contract/routes';

let world: World;
eachWorld(created => {
	world = created;
	world.runReleaseWorkflows();
});

const buildThenPromote = [{ id: 'build', group: 'widget' }, { id: 'promote', group: 'widget', needs: ['build'] }];

async function releaseSet(operations: unknown[] = buildThenPromote) {
	const token = await world.cliSession();
	const transport = cliTransport(world, token);
	const repository = await discoveredWidget(world, token);
	world.github.push(repository, {
		'.github/workflows/build.yml': dispatchedPublishWorkflow('Build', 'main', 'build', '      - run: make\n'),
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					versionScope: 'per-package',
					packages: ['pkg:npm/widget'],
					mustPublish: ['pkg:npm/widget'],
					prepare: { strategy: 'managed' },
					promote: {
						publishWhen: 'approved-in-beepboop',
						workflow: { file: 'publish.yml', publications: ['pkg:npm/widget'] },
					},
					workflows: { build: { file: 'build.yml' } },
				},
			},
		}),
	}, 'Build before the release');
	await call(routes.repositoriesDiscover, { repository: repository.name }, transport);
	const plan = { groups: [{ id: 'widget', packages: ['pkg:npm/widget'], version: { bump: 'minor' } }], operations };
	const request = { repositoryId: repository.id, stream: 'main', plan };
	const reviewed = await call(routes.releasesPlanSet, request, transport);
	const preparation = await call(
		routes.releasesPrepareSet,
		{ ...request, sourceSha: reviewed.sourceSha, planId: reviewed.planId },
		transport,
	);
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('The release set opened no PR');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	const started = await call(
		routes.releasesStartSet,
		{ preparationId: preparation.id, sourceSha: merged.sha },
		transport,
	);
	const workflowId = `release-${preparation.id}`;
	const labels = new Map<string, string>([[preparation.id, 'preparation'], [merged.sha, 'merged']]);
	for (const operation of started) labels.set(operation.id, operation.operation);
	const steps = (record: WorkflowRecord<ReleaseWorkflowParams>) =>
		record.steps.map(step => {
			const value = step.value instanceof Error ? `Error(${step.value.message})` : JSON.stringify(step.value);
			return [...labels].reduce(
				(line, [id, label]) => line.replaceAll(id, `<${label}>`),
				`${step.kind} ${step.name}${value === undefined ? '' : ` ${value}`}`,
			);
		});
	const idle = async () => steps(await world.releaseWorkflow.idle(workflowId));
	const operation = (name: string) => {
		const found = started.find(entry => entry.operation === name);
		if (!found) throw new Error(`The release set has no ${name} operation`);
		return found;
	};
	const stored = async (name: string) => {
		const execution = await world.coordinator(repository).execution(operation(name).id);
		if (!execution) throw new Error(`The coordinator lost ${name}`);
		return execution;
	};
	const approve = (name: string) =>
		call(routes.executionsApprove, { id: operation(name).id, sourceSha: merged.sha }, transport);
	return { repository, transport, preparation, merged, workflowId, idle, operation, stored, approve };
}

function lastRun(repository: Repository, file: string): Run {
	const run = repository.runs.filter(entry => entry.path === `.github/workflows/${file}`).at(-1);
	if (!run) throw new Error(`No ${file} run`);
	return run;
}

async function finish(repository: Repository, run: Run, conclusion: 'success' | 'failure'): Promise<void> {
	run.status = 'completed';
	run.conclusion = conclusion;
	await world.workflowRun(repository, run, conclusion, 'workflow_dispatch');
	await world.wait(2_000);
}

async function publish(
	repository: Repository,
	execution: string,
	publication: Record<string, string>,
): Promise<Run> {
	const run = lastRun(repository, 'publish.yml');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'publish.yml');
	await begin(world, identity, execution, 'main', 'promote');
	await runAction(world, 'report', identity, {
		EXECUTION_ID: execution,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', ...publication },
		]),
	});
	return run;
}

const loaded = (promote = '{"id":"<promote>","operation":"promote","paced":false,"dependencies":["<build>"]}') =>
	`do Load release operations [{"id":"<build>","operation":"build","paced":false,"dependencies":[]},${promote}]`;

test('a release workflow advances each operation after its dependencies and completes the release', async () => {
	const { repository, workflowId, idle, operation, stored, approve } = await releaseSet();
	await world.wait(1_000);
	await idle();
	await finish(repository, lastRun(repository, 'build.yml'), 'success');
	await idle();
	expect((await stored('build')).state).toBe('succeeded');
	expect((await approve('promote')).state).toBe('ready');
	await world.wait(1_000);
	await idle();
	world.npm.publish('widget', '1.1.0');
	await finish(repository, await publish(repository, operation('promote').id, { outcome: 'succeeded' }), 'success');

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'do build: reconcile 2 "succeeded"',
		'do promote: reconcile 0 "awaiting-approval"',
		'do promote: delay 0 0',
		'wait promote: wait 0 ["<promote>","1 hour"]',
		'do promote: reconcile 1 "awaiting-approval"',
		'do promote: delay 1 0',
		'wait promote: wait 1 ["<promote>","1 hour"]',
		'do promote: reconcile 2 "awaiting-approval"',
		'do promote: delay 2 0',
		'wait promote: wait 2 ["<promote>","1 hour"]',
		'do promote: reconcile 3 "dispatching"',
		'do promote: delay 3 0',
		'wait promote: wait 3 ["<promote>","1 hour"]',
		'do promote: reconcile 4 "succeeded"',
		'do Complete release',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('complete');
	expect((await stored('promote')).state).toBe('succeeded');
});

test('a release workflow reconciles again when its wait for an operation times out', async () => {
	const { workflowId, idle } = await releaseSet();
	await world.wait(1_000);
	await idle();
	world.releaseWorkflow.expire(workflowId);

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'do build: reconcile 2 "running"',
		'do build: delay 2 0',
		'wait build: wait 2 ["<build>","1 hour"]',
	]);
});

test('a failed release workflow records the interruption and recovery restarts it', async () => {
	const { repository, transport, preparation, merged, workflowId, idle, operation, stored } = await releaseSet();
	await world.wait(1_000);
	await idle();
	const storage = world.coordinators.instance(String(repository.id)).storage;
	const key = `release-set:${preparation.id}`;
	const release = await storage.get(key);
	await storage.put(key, { target: merged.sha, ids: [operation('promote').id], workflowId, started: true });
	world.releaseWorkflow.expire(workflowId);
	await idle();
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('errored');
	expect((await stored('promote')).releaseSet?.workflowError).toBe(
		'Release coordination interrupted. Check coordination to resume.',
	);
	await storage.put(key, release);
	await call(routes.executionsRecover, { id: operation('build').id, action: 'reconcile' }, transport);

	expect(await idle()).toEqual([
		loaded(),
		'do build: reconcile 0 "dispatching"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
		'do build: reconcile 1 "running"',
		'do build: delay 1 0',
		'wait build: wait 1 ["<build>","1 hour"]',
		'throw build: reconcile 2 Error(Operation is not in this release)',
		'do Record coordination failure',
		loaded(),
		'do build: reconcile 0 "running"',
		'do build: delay 0 0',
		'wait build: wait 0 ["<build>","1 hour"]',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.restarts).toBe(1);
	expect(world.coordinators.calls.filter(entry => entry.method === 'advanceReleaseOperation')).toHaveLength(9);
	expect((await stored('promote')).releaseSet?.workflowError).toBeUndefined();
});

test('a paced release operation reserves its slot, sleeps, and waits out a registry rate limit', async () => {
	const { repository, workflowId, idle, operation, stored, approve } = await releaseSet([
		{ id: 'promote', group: 'widget' },
	]);
	const promotion = operation('promote');
	const storage = world.coordinators.instance(String(repository.id)).storage;
	await storage.put(`execution:${promotion.id}`, {
		...await stored('promote'),
		package: { id: 'pkg:npm/widget', manager: 'cargo' },
	});
	await world.budgets.instance('crates-io').storage.put('arrival:update', Date.now() + 40 * 60_000);
	await world.wait(1_000);
	await idle();
	expect((await approve('promote')).state).toBe('ready');
	await world.wait(1_000);
	await idle();
	const until = new Date(Date.now() + 30 * 60_000).toISOString();
	await finish(
		repository,
		await publish(repository, promotion.id, { outcome: 'rate-limited', retryAfter: until }),
		'failure',
	);
	await idle();
	world.npm.publish('widget', '1.1.0');
	await finish(repository, await publish(repository, promotion.id, { outcome: 'succeeded' }), 'success');

	const label = 'promote pkg:npm/widget';
	expect(await idle()).toEqual([
		'do Load release operations [{"id":"<promote>","operation":"promote pkg:npm/widget","paced":true,"dependencies":[]}]',
		`do ${label}: reserve 659000`,
		`sleep ${label}: paced 659000`,
		`do ${label}: reconcile 0 "awaiting-approval"`,
		`do ${label}: delay 0 0`,
		`wait ${label}: wait 0 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 1 "awaiting-approval"`,
		`do ${label}: delay 1 0`,
		`wait ${label}: wait 1 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 2 "dispatching"`,
		`do ${label}: delay 2 0`,
		`wait ${label}: wait 2 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 3 "ready"`,
		`do ${label}: delay 3 1800000`,
		`sleep ${label}: deferred 3 1800000`,
		`do ${label}: reconcile 4 "dispatching"`,
		`do ${label}: delay 4 0`,
		`wait ${label}: wait 4 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 5 "running"`,
		`do ${label}: delay 5 1798000`,
		`sleep ${label}: deferred 5 1798000`,
		`do ${label}: reconcile 6 "running"`,
		`do ${label}: delay 6 0`,
		`wait ${label}: wait 6 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 7 "running"`,
		`do ${label}: delay 7 0`,
		`wait ${label}: wait 7 ["<promote>","1 hour"]`,
		`do ${label}: reconcile 8 "succeeded"`,
		'do Complete release',
	]);
	expect(world.releaseWorkflow.instances.get(workflowId)?.status).toBe('complete');
	expect(world.budgets.calls.map(entry => entry.method)).toEqual(['reserve', 'defer']);
});
