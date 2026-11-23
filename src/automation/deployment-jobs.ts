import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import { yaml } from '@/kernel/parse/yaml.ts';

export function deploymentJobs(source: string): string[] {
	const parsed = yaml(source);
	if (Result.isFailure(parsed)) return [];
	return Object.entries(object(parsed.success.jobs)).flatMap(([id, value]) => {
		const job = object(value);
		if (job.environment === undefined || job.environment === null) return [];
		return [typeof job.name === 'string' ? job.name : id];
	});
}

export function deploys(check: string, jobs: readonly string[]): boolean {
	return jobs.some(job => check === job || check.startsWith(`${job} (`));
}
