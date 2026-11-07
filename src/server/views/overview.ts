import { readiness } from '@/domain/repository';
import type { ViewOf } from '@/server/loaders.ts';
import { releaseSummaries } from '@/server/releases.ts';

export function overview({ repositories, executions }: ViewOf<'overview'>) {
	const attention =
		executions.readable.filter(e =>
			['awaiting-approval', 'blocked', 'failed', 'uncertain', 'cancelled'].includes(e.state)
		).length
		+ executions.unreadable.length;
	const running = executions.readable.filter(e => ['running', 'ready', 'dispatching', 'verifying'].includes(e.state))
		.length;
	const setup = repositories.readable.filter(r => readiness(r).kind !== 'ready').length
		+ repositories.unreadable.length;
	return {
		attention,
		running,
		setup,
		unconnected: !repositories.readable.length && !repositories.unreadable.length,
		releases: releaseSummaries(executions.readable).slice(0, 10),
	};
}
