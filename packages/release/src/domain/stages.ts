import { publicationStages } from '@/domain/publication-stages.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

function configuredStages(run: Execution): Map<string, string[]> {
	const stream = run.configuration.streams[run.stream];
	if (!stream) return new Map();
	const needs = new Map<string, string[]>([
		['prepare', stream.prepare.workflow?.needs ?? []],
		['promote', [...stream.promote.workflow?.needs ?? [], 'prepare']],
		...Object.entries(stream.workflows).map(([name, binding]): [string, string[]] => [name, binding.needs ?? []]),
	]);
	const order = publicationStages([...needs.keys()], Object.fromEntries(needs)).flat();
	return new Map(order.map(name => [name, needs.get(name) ?? []]));
}

function follows(stage: string, started: ReadonlySet<string>, needs: ReadonlyMap<string, string[]>): boolean {
	const seen = new Set<string>();
	const reaches = (name: string): boolean => {
		if (seen.has(name)) return false;
		seen.add(name);
		return (needs.get(name) ?? []).some(need => started.has(need) || reaches(need));
	};
	return reaches(stage);
}

export function pipelineStages(latest: Execution, runs: readonly Execution[]): string[] {
	const needs = configuredStages(latest);
	const started = new Set(runs.map(run => run.operation));
	return [
		...[...needs.keys()].filter(name => started.has(name) || follows(name, started, needs)),
		...[...started].filter(name => !needs.has(name)),
	];
}
