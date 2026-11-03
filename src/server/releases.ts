import { matchesPublication } from '@/automation/package-identity';
import type { Execution } from '@/automation/types.ts';

/** Never combine evidence from different commits, configurations, or versions. */
export function releaseSummaries(executions: Execution[]) {
	const groups = new Map<string, Execution[]>();
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
		const group = groups.get(identity) ?? [];
		group.push(execution);
		groups.set(identity, group);
	}
	return [...groups.values()].map(runs => {
		const first = runs[0];
		if (!first) throw new Error('Release group is empty');
		const required = first.releaseSet?.required ?? first.configuration.streams[first.stream]?.required ?? [];
		const publications = required.map(id => {
			const reports = runs.flatMap(run => run.publications.filter(publication => matchesPublication(id, publication)));
			const succeeded = reports.find(report => report.outcome === 'succeeded');
			return { id, outcome: succeeded?.outcome ?? reports.at(-1)?.outcome ?? 'waiting' };
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

/** Group the operations of one frozen monorepo release, including independent versions. */
export function releaseSetSummaries(executions: Execution[]) {
	const sets = new Map<string, Execution[]>();
	for (const execution of executions) {
		if (!execution.releaseSet?.workflowId) continue;
		const id = execution.releaseSet.workflowId;
		const runs = sets.get(id) ?? [];
		runs.push(execution);
		sets.set(id, runs);
	}
	return [...sets].map(([id, runs]) => {
		const first = runs[0];
		if (!first?.releaseSet) throw new Error('Empty release set');
		const total = first.releaseSet.operationCount ?? runs.length;
		const complete = runs.filter(run => run.state === 'succeeded').length;
		const error = runs.find(run => run.releaseSet?.workflowError)?.releaseSet?.workflowError;
		const attention = Boolean(error) || runs.some(run => ['failed', 'cancelled', 'uncertain'].includes(run.state));
		return {
			id,
			repository: first.repository,
			sourceSha: first.sourceSha,
			total,
			complete,
			runs,
			error,
			recoveryId: first.id,
			state: complete === total ? 'succeeded' : attention
				? 'needs attention'
				: runs.some(run => run.operation === 'promote' && run.state === 'blocked')
				? 'awaiting approval'
				: 'in progress',
		};
	});
}
