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

function literals(label: string): string[] | undefined {
	const parts: string[] = [];
	let rest = label;
	for (let open = rest.indexOf('${{'); open >= 0; open = rest.indexOf('${{')) {
		parts.push(rest.slice(0, open));
		let quoted = false;
		let close = -1;
		for (let at = open + 3; at < rest.length - 1; at++) {
			if (rest[at] === "'") quoted = !quoted;
			else if (!quoted && rest[at] === '}' && rest[at + 1] === '}') {
				close = at;
				break;
			}
		}
		if (close < 0) return undefined;
		rest = rest.slice(close + 2);
	}
	return [...parts, rest];
}

function names(check: string, job: CheckJob): boolean {
	const parts = literals(job.label);
	if (!parts) return true;
	if (parts.length > 1) return new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`).test(check);
	return check === job.label || (job.matrix && check.startsWith(`${job.label} (`));
}

export function deploys(check: string, jobs: readonly CheckJob[]): boolean {
	const matched = jobs.filter(job => names(check, job));
	return matched.length > 0 && matched.every(job => job.deploys);
}
