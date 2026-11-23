import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import { yaml } from '@/kernel/parse/yaml.ts';
import { escapeRegExp } from '@/kernel/text/patterns.ts';

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

function names(check: string, job: CheckJob): boolean {
	if (job.label.includes('${{')) {
		const parts = job.label.split(/\$\{\{[^}]*\}\}/).map(escapeRegExp);
		return new RegExp(`^${parts.join('.+')}$`).test(check);
	}
	return check === job.label || (job.matrix && check.startsWith(`${job.label} (`));
}

export function deploys(check: string, jobs: readonly CheckJob[]): boolean {
	const matched = jobs.filter(job => names(check, job));
	return matched.length > 0 && matched.every(job => job.deploys);
}
