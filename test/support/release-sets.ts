import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client.ts';
import type { Repository, Run } from '@root/test/support/github.ts';
import { dispatchedPublishWorkflow, passChecks } from '@root/test/support/repositories.ts';
import type { WorkflowRecord } from '@root/test/support/workflows.ts';
import type { World } from '@root/test/support/world.ts';
import { routes } from '@/contract/routes';
import type { ReleaseWorkflowParams } from '@/server/durable/release-workflow.ts';

const buildThenPromote = [{ id: 'build', group: 'widget' }, { id: 'promote', group: 'widget', needs: ['build'] }];

export async function releaseSet(world: World, operations: unknown[] = buildThenPromote) {
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

export function lastRun(repository: Repository, file: string): Run {
	const run = repository.runs.filter(entry => entry.path === `.github/workflows/${file}`).at(-1);
	if (!run) throw new Error(`No ${file} run`);
	return run;
}

export async function finish(
	world: World,
	repository: Repository,
	run: Run,
	conclusion: 'success' | 'failure',
): Promise<void> {
	run.status = 'completed';
	run.conclusion = conclusion;
	await world.workflowRun(repository, run, conclusion, 'workflow_dispatch');
	await world.wait(2_000);
}

export async function publish(
	world: World,
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

export const loaded = (
	promote = '{"id":"<promote>","operation":"promote","paced":false,"dependencies":["<build>"]}',
) => `do Load release operations [{"id":"<build>","operation":"build","paced":false,"dependencies":[]},${promote}]`;
