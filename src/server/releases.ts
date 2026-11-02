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
		]);
		const group = groups.get(identity) ?? [];
		group.push(execution);
		groups.set(identity, group);
	}
	return [...groups.values()].map(runs => {
		const first = runs[0];
		if (!first) throw new Error('Release group is empty');
		const required = first.configuration.streams[first.stream]?.required ?? [];
		const publications = required.map(id => {
			const reports = runs.flatMap(run => run.publications.filter(publication => publication.id === id));
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
