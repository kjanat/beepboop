import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import { yaml } from '@/kernel/parse/yaml.ts';

export interface CheckJob {
	label: string;
	matrix: boolean;
	deploys: boolean;
	calls: boolean;
}

export function checkJobs(source: string): CheckJob[] {
	const parsed = yaml(source);
	if (Result.isFailure(parsed)) return [];
	return Object.entries(object(parsed.success.jobs)).map(([id, value]) => {
		const job = object(value);
		const calls = typeof job.uses === 'string';
		return {
			label: typeof job.name === 'string' ? job.name : id,
			matrix: object(job.strategy).matrix !== undefined,
			deploys: !calls && job.environment !== undefined && job.environment !== null,
			calls,
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

const lineBreak = /[\n\r\u2028\u2029]/;

function fits(text: string, parts: readonly string[]): boolean {
	const first = parts[0] ?? '';
	if (parts.length === 1) return text === first;
	const last = parts.at(-1) ?? '';
	const end = text.length - last.length;
	if (end < first.length || !text.startsWith(first) || !text.endsWith(last)) return false;
	let at = first.length;
	for (const part of parts.slice(1, -1)) {
		const found = text.indexOf(part, at);
		if (found < 0 || found + part.length > end || lineBreak.test(text.slice(at, found))) return false;
		at = found + part.length;
	}
	return !lineBreak.test(text.slice(at, end));
}

function shapes(parts: readonly string[], job: CheckJob): string[][] {
	const init = parts.slice(0, -1);
	const last = parts.at(-1) ?? '';
	if (job.calls) return [[...init, `${last} / `, ''], [...init, `${last} (`, ') / ', '']];
	return parts.length === 1 && job.matrix ? [[...parts], [`${last} (`, '']] : [[...parts]];
}

function names(check: string, job: CheckJob): boolean {
	const parts = literals(job.label);
	return !parts || shapes(parts, job).some(shape => fits(check, shape));
}

export function deploys(check: string, jobs: readonly CheckJob[]): boolean {
	const matched = jobs.filter(job => names(check, job));
	return matched.length > 0 && matched.every(job => job.deploys);
}
