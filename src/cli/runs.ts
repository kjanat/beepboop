import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import type { Client } from '@/cli/client';
import { checkoutRepository } from '@/cli/release';
import { routes } from '@/contract/routes';
import type { ExecutionStateView, ExecutionView } from '@/contract/views';

export interface RunFilters {
	repository?: string | undefined;
	all: boolean;
	stream?: string | undefined;
	operation?: string | undefined;
	state: readonly ExecutionStateView[];
	version?: string | undefined;
	limit?: number | undefined;
}

const ownerName = /^[\w.-]+\/[\w.-]+$/;

export function listedRepository(
	client: Client,
	filters: Pick<RunFilters, 'repository' | 'all'>,
	cwd = process.cwd(),
): Effect.Effect<string | undefined, CLIError> {
	return Effect.gen(function*() {
		if (filters.all) return undefined;
		if (filters.repository === undefined) {
			return yield* checkoutRepository(cwd).pipe(Effect.orElseSucceed(() => undefined));
		}
		if (ownerName.test(filters.repository)) return filters.repository;
		return (yield* client.call(routes.repositoriesResolve, { repository: filters.repository })).name;
	});
}

export function filterRuns(
	runs: readonly ExecutionView[],
	repository: string | undefined,
	filters: RunFilters,
): ExecutionView[] {
	const matching = runs.filter(run =>
		(repository === undefined || run.repository.toLowerCase() === repository.toLowerCase())
		&& (filters.stream === undefined || run.stream === filters.stream)
		&& (filters.operation === undefined || run.operation === filters.operation)
		&& (!filters.state.length || filters.state.includes(run.state))
		&& (filters.version === undefined || run.version === filters.version)
	);
	return filters.limit === undefined ? matching : matching.slice(0, filters.limit);
}

export function slimRun(run: ExecutionView) {
	const publications = Array.isArray(run.publications)
		? run.publications.flatMap((entry: unknown) => {
			if (typeof entry !== 'object' || entry === null || !('id' in entry) || !('outcome' in entry)) return [];
			return [{ id: entry.id, outcome: entry.outcome }];
		})
		: [];
	return {
		id: run.id,
		repository: run.repository,
		stream: run.stream,
		operation: run.operation,
		state: run.state,
		version: run.version,
		sourceSha: run.sourceSha,
		updatedAt: run.updatedAt,
		publications,
	};
}

export function serverFilter(repository: string | undefined, filters: RunFilters) {
	return {
		...(repository === undefined ? {} : { repository }),
		...(filters.stream === undefined ? {} : { stream: filters.stream }),
		...(filters.operation === undefined ? {} : { operation: filters.operation }),
		...(filters.state.length ? { states: filters.state.join(',') } : {}),
		...(filters.version === undefined ? {} : { version: filters.version }),
		...(filters.limit === undefined || filters.limit < 1 ? {} : { limit: filters.limit }),
	};
}
