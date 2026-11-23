import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import { yaml } from '@/kernel/parse/yaml.ts';

export interface CheckJob {
	label: string;
	matrix: boolean;
	deploys: boolean;
}

export function checkJobs(source: string): CheckJob[] {
	const parsed = yaml(source);
	if (Result.isFailure(parsed)) return [];
	return Object.entries(object(parsed.success.jobs)).map(([id, value]) => {
		const job = object(value);
		return {
			label: typeof job.name === 'string' ? job.name : id,
			matrix: object(job.strategy).matrix !== undefined,
			deploys: job.environment !== undefined && job.environment !== null,
		};
	});
}

export function deploys(check: string, jobs: readonly CheckJob[]): boolean {
	const matched = jobs.filter(job => check === job.label || (job.matrix && check.startsWith(`${job.label} (`)));
	return matched.length > 0 && matched.every(job => job.deploys);
}
