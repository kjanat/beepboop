import { matchesPublication } from '@/automation/package-identity';
import type { Execution, Publication } from '@/automation/types.ts';

/** Never combine evidence from different commits, configurations, or versions. */
export function releaseSummaries(executions: Execution[]) {
	const groups = new Map<string, { first: Execution; runs: Execution[] }>();
	for (const execution of executions) {
		const identity = JSON.stringify([
			execution.repositoryId,
			execution.stream,
			execution.sourceSha,
			execution.configurationSha,
			execution.version,
			execution.releaseSet?.group,
			execution.releaseSet?.preparationId,
		]);
		const group = groups.get(identity);
		if (group) group.runs.push(execution);
		else groups.set(identity, { first: execution, runs: [execution] });
	}
	return [...groups.values()].map(({ first, runs }) => {
		const required = first.releaseSet?.required ?? first.configuration.streams[first.stream]?.required ?? [];
		const publications = required.map(id => {
			const reports = runs.flatMap(run => run.publications.filter(publication => matchesPublication(id, publication)));
			const succeeded = reports.find(report => report.outcome === 'succeeded');
			const outcome: Publication['outcome'] | 'waiting' = succeeded?.outcome ?? reports.at(-1)?.outcome ?? 'waiting';
			return { id, outcome };
		});
		const verified = publications.filter(p => p.outcome === 'succeeded').length;
		return {
			repository: first.repository,
			stream: first.stream,
			commit: first.sourceSha,
			version: first.version,
			runs,
			publications,
			verified,
			updatedAt: Math.max(...runs.map(run => run.updatedAt)),
			attention: runs.some(run => ['blocked', 'failed', 'cancelled', 'uncertain'].includes(run.state)),
		};
	}).sort((a, b) => b.updatedAt - a.updatedAt);
}

export type ReleaseSetState = 'succeeded' | 'needs attention' | 'awaiting approval' | 'in progress';

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
		const attention = Boolean(error) || runs.some(run => ['failed', 'cancelled', 'uncertain'].includes(run.state));
		const state: ReleaseSetState = complete === total
			? 'succeeded'
			: attention
			? 'needs attention'
			: runs.some(run => run.operation === 'promote' && run.state === 'blocked')
			? 'awaiting approval'
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
