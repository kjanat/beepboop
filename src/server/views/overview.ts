import { readiness } from '@/domain/repository';
import type { ViewOf } from '@/server/loaders.ts';
import { activeStates, needsUser, releaseSummaries } from '@/server/releases.ts';

export function overview({ repositories, executions }: ViewOf<'overview'>) {
	const waiting = executions.readable
		.filter(run => needsUser(run, executions.readable))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	const running = executions.readable.filter(e => activeStates.includes(e.state)).length;
	const setup = repositories.readable.filter(r => readiness(r).kind !== 'ready').length
		+ repositories.unreadable.length;
	return {
		attention: waiting.length + executions.unreadable.length,
		waiting,
		unreadable: executions.unreadable.length,
		running,
		setup,
		unconnected: !repositories.readable.length && !repositories.unreadable.length,
		releases: releaseSummaries(executions.readable, repositories.readable).slice(0, 10),
	};
}
