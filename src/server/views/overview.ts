import { newestActiveFirst } from '@/automation/execution-order.ts';
import { readiness } from '@/domain/repository';
import type { ViewOf } from '@/server/loaders.ts';
import { activeStates, needingUser, releaseSummaries } from '@/server/releases.ts';

export function overview({ repositories, executions, completed }: ViewOf<'overview'>) {
	const needing = needingUser(executions.readable, completed);
	const waiting = executions.readable
		.filter(run => needing.has(run.id))
		.sort(newestActiveFirst);
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
		releases: releaseSummaries(executions.readable, repositories.readable, needing).slice(0, 10),
	};
}
