import { matchesPackage, matchesPublication } from '@/automation/package-identity';
import type { Execution, Publication, RepositoryRecord } from '@/automation/types.ts';

export const activeStates: readonly string[] = ['running', 'ready', 'dispatching', 'verifying'];

export function publishesAutomatically(run: Execution): boolean {
	return run.state === 'awaiting-approval'
		&& (run.configuration.streams[run.stream]?.promote.approval === 'push' || run.approvedBy !== undefined);
}

export function runStateLabel(run: Execution): string {
	return publishesAutomatically(run) ? 'publishing once its checks pass' : runStateLabels[run.state];
}

const runStateLabels = {
	pending: 'waiting to start',
	'awaiting-approval': 'waiting for you to publish',
	blocked: 'blocked',
	ready: 'ready',
	dispatching: 'starting',
	running: 'running',
	verifying: 'checking the registries',
	succeeded: 'succeeded',
	failed: 'failed',
	cancelled: 'cancelled',
	uncertain: 'outcome unknown',
} as const satisfies Record<Execution['state'], string>;

function target(run: Execution): string {
	const plan = run.managed?.plan ?? run.plan;
	const groups = plan && 'groups' in plan ? plan.groups.map(group => [group.id, group.version, group.packages]) : null;
	const known = run.version !== undefined || run.releaseSet !== undefined || run.package !== undefined || groups;
	return JSON.stringify([
		run.version ?? null,
		run.releaseSet?.group ?? null,
		run.package ?? null,
		groups,
		known ? null : run.id,
	]);
}

export function needsUser(run: Execution, executions: readonly Execution[]): boolean {
	if (run.state === 'awaiting-approval') return !publishesAutomatically(run);
	if (run.state === 'blocked' || run.state === 'uncertain') return true;
	if (run.state !== 'failed' && run.state !== 'cancelled') return false;
	return !executions.some(other =>
		other.id !== run.id && other.repositoryId === run.repositoryId && other.stream === run.stream
		&& other.operation === run.operation && target(other) === target(run) && other.createdAt > run.createdAt
	);
}

export function releaseSummaries(executions: Execution[], repositories: RepositoryRecord[] = []) {
	const groups = new Map<string, [Execution, ...Execution[]]>();
	for (const execution of executions) {
		const identity = JSON.stringify([
			execution.repositoryId,
			execution.stream,
			execution.version ?? execution.id,
			execution.releaseSet?.group,
		]);
		const group = groups.get(identity);
		if (group) group.push(execution);
		else groups.set(identity, [execution]);
	}
	return [...groups.values()].map(group => {
		const runs = group.sort((a, b) => a.createdAt - b.createdAt);
		const latest = runs[runs.length - 1] ?? runs[0];
		const required = latest.releaseSet?.required ?? latest.configuration.streams[latest.stream]?.required ?? [];
		const publications = required.map(id => {
			const reports = runs.flatMap(run => run.publications.filter(publication => matchesPublication(id, publication)));
			const succeeded = reports.find(report => report.outcome === 'succeeded');
			const registered = repositories.find(repository => repository.id === latest.repositoryId)?.inventory.packages
				.some(pkg =>
					matchesPackage(id, pkg) && pkg.publicationStatus === 'published' && latest.version !== undefined
					&& pkg.published === latest.version
				);
			const outcome: Publication['outcome'] | 'waiting' = succeeded?.outcome
				?? (registered ? 'succeeded' : reports.at(-1)?.outcome ?? 'waiting');
			return { id, outcome };
		});
		const verified = publications.filter(p => p.outcome === 'succeeded').length;
		return {
			repository: latest.repository,
			stream: latest.stream,
			commit: latest.sourceSha,
			version: latest.version,
			runs,
			latest,
			publications,
			verified,
			updatedAt: Math.max(...runs.map(run => run.updatedAt)),
			attention: runs.some(run => needsUser(run, executions)),
		};
	}).sort((a, b) => b.updatedAt - a.updatedAt);
}

export type ReleaseSetState = 'succeeded' | 'needs attention' | 'waiting for you to publish' | 'in progress';

/** Group the operations of one frozen monorepo release, including independent versions. */
export function releaseSetSummaries(executions: Execution[]) {
	const sets = new Map<string, { first: Execution; operationCount?: number; runs: Execution[] }>();
	for (const execution of executions) {
		const id = execution.releaseSet?.workflowId;
		if (!id) continue;
		const set = sets.get(id);
		if (set) set.runs.push(execution);
		else sets.set(id, { first: execution, operationCount: execution.releaseSet?.operationCount, runs: [execution] });
	}
	return [...sets].map(([id, { first, operationCount, runs }]) => {
		const total = operationCount ?? runs.length;
		const complete = runs.filter(run => run.state === 'succeeded').length;
		const error = runs.find(run => run.releaseSet?.workflowError)?.releaseSet?.workflowError;
		const attention = Boolean(error)
			|| runs.some(run => ['blocked', 'failed', 'cancelled', 'uncertain'].includes(run.state));
		const state: ReleaseSetState = complete === total
			? 'succeeded'
			: attention
			? 'needs attention'
			: runs.some(run => run.state === 'awaiting-approval' && !publishesAutomatically(run))
			? 'waiting for you to publish'
			: 'in progress';
		return {
			id,
			repository: first.repository,
			sourceSha: first.sourceSha,
			total,
			complete,
			runs,
			error,
			recoveryId: first.id,
			state,
		};
	});
}
