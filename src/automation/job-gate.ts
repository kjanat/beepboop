import { parseDocument } from 'yaml';
import { z } from 'zod';

const jobSchema = z.looseObject({
	name: z.unknown().optional(),
	needs: z.union([z.string(), z.array(z.string())]).optional(),
	if: z.unknown().optional(),
});
const workflowSchema = z.looseObject({ jobs: z.record(z.string(), jobSchema) });

export interface GateJob {
	display?: string;
	needs: string[];
	plain: boolean;
}
export type WorkflowJobs = ReadonlyMap<string, GateJob>;
export interface RunJob {
	name: string;
	status: string;
	conclusion: string | null;
	started_at?: string | null | undefined;
	completed_at?: string | null | undefined;
}
export type GateState = 'ready' | 'blocked' | 'waiting';
type JobStatus = 'passed' | 'failed' | 'pending';

export function jobNeeds<T>(needs: T | T[] | undefined): T[] {
	return needs === undefined ? [] : Array.isArray(needs) ? needs : [needs];
}

export function workflowJobs(source: string): WorkflowJobs | undefined {
	const document = parseDocument(source);
	if (document.errors.length) return undefined;
	const parsed = workflowSchema.safeParse(document.toJS());
	if (!parsed.success) return undefined;
	return new Map(
		Object.entries(parsed.data.jobs).map(([key, job]): [string, GateJob] => {
			const name = typeof job.name === 'string' ? job.name : key;
			const condition = typeof job.if === 'string' ? job.if : '';
			return [key, {
				...(name.includes('${{') ? {} : { display: name }),
				needs: jobNeeds(job.needs),
				plain: !/\b(?:always|failure|cancelled)\s*\(|\.result\b/.test(condition),
			}];
		}),
	);
}

function coverers(jobs: WorkflowJobs, key: string): string[] {
	return [...jobs].filter(([, job]) => job.display !== undefined && job.plain && job.needs.includes(key)).map((
		[name],
	) => name);
}

export function resolvable(jobs: WorkflowJobs, keys: readonly string[]): boolean {
	return keys.every(key => {
		const job = jobs.get(key);
		return job !== undefined && (job.display !== undefined || coverers(jobs, key).length > 0);
	});
}

export function gateJobs(jobs: WorkflowJobs, publishing: readonly string[]): string[] {
	const ancestors = (key: string, seen = new Set<string>()): Set<string> => {
		for (const need of jobs.get(key)?.needs ?? []) {
			if (seen.has(need)) continue;
			seen.add(need);
			ancestors(need, seen);
		}
		return seen;
	};
	const roots = publishing.filter(key => ![...ancestors(key)].some(ancestor => publishing.includes(ancestor)));
	const keys = new Set(roots.flatMap(key => [...ancestors(key)]));
	const ordered = [...jobs.keys()].filter(key => keys.has(key));
	return resolvable(jobs, ordered) ? ordered : [];
}

export function gateState(jobs: WorkflowJobs, keys: readonly string[], run: readonly RunJob[]): GateState {
	const matching = (display: string) => run.filter(job => job.name === display || job.name.startsWith(`${display} (`));
	const succeeded = (display: string) => {
		const found = matching(display);
		return found.length > 0 && found.every(job => job.status === 'completed' && job.conclusion === 'success');
	};
	const finished = (display: string) => {
		const found = matching(display);
		return found.length > 0 && found.every(job => job.status === 'completed');
	};
	const memo = new Map<string, JobStatus>();
	const evaluate = (key: string): JobStatus => {
		const job = jobs.get(key);
		if (!job) return 'failed';
		const display = job.display;
		if (display === undefined) {
			const covering = coverers(jobs, key).flatMap(name => jobs.get(name)?.display ?? []);
			if (covering.some(succeeded)) return 'passed';
			return covering.every(finished) ? 'failed' : 'pending';
		}
		const found = matching(display);
		if (!found.length || found.some(entry => entry.status !== 'completed')) return 'pending';
		if (found.every(entry => entry.conclusion === 'success')) return 'passed';
		if (found.some(entry => entry.conclusion !== 'success' && entry.conclusion !== 'skipped')) return 'failed';
		const needs = job.needs.map(status);
		return needs.includes('failed') ? 'failed' : needs.includes('pending') ? 'pending' : 'passed';
	};
	const status = (key: string): JobStatus => {
		const known = memo.get(key);
		if (known) return known;
		memo.set(key, 'failed');
		const result = evaluate(key);
		memo.set(key, result);
		return result;
	};
	const states = keys.map(status);
	return states.includes('failed') ? 'blocked' : states.every(state => state === 'passed') ? 'ready' : 'waiting';
}
