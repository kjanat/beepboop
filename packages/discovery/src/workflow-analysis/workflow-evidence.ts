import { Result } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { workflowEvents } from '@/discovery/release-graph/calls.ts';
import { jobNeeds } from '@/discovery/workflow-analysis/job-gate.ts';
import { ownedBinaryJob } from '@/discovery/workflow-analysis/owned-binary-job.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { yaml } from '@/kernel/parse/yaml.ts';
import { identifierPattern } from '@/kernel/schema/ids.ts';

export interface WorkflowEvidence {
	tagPatterns?: string[];
	file: string;
	jobs: string[];
	steps: { job: string; id: string; label: string }[];
	events: string[];
	roles: { job: string; stream: string; operation: string }[];
	preparationJobs: string[];
	reportingJobs: string[];
	jobObstacles?: Record<string, string[]>;
	prepares: boolean;
	reports: boolean;
	publishes: boolean;
}

export function actionRole(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	return /^(?:(?:\$|\.)\/actions\/|kjanat\/beepboop\/actions\/)(begin|prepare|report|publish)(?:@[\w./-]+)?$/.exec(
		value,
	)?.[1];
}
export function workflowEvidence(file: string, source: string): Result.Result<WorkflowEvidence, DomainError> {
	return yaml(source).pipe(Result.map(document => evidenceOf(file, document)));
}
/** Why setup cannot patch a job in place; integrate refuses the same jobs. */
export function jobObstacles(jobs: Record<string, unknown>): Record<string, string[]> {
	const result: Record<string, string[]> = Object.create(null);
	for (const [name, value] of Object.entries(jobs)) {
		const job = object(value);
		const needs = jobNeeds(job.needs).filter(need =>
			typeof need !== 'string' || !ownedBinaryJob(need, object(jobs[need]))
		);
		const reasons = [
			...(job.uses ? ['reusable workflow call'] : []),
			...(job.strategy ? ['matrix'] : []),
			...(needs.length ? [`needs ${needs.map(String).join(', ')}`] : []),
			...(job.if ? ['conditional'] : []),
			...(job.container ? ['container'] : []),
		];
		if (reasons.length) result[name] = reasons;
	}
	return result;
}
function evidenceOf(file: string, document: Record<string, unknown>): WorkflowEvidence {
	const result: WorkflowEvidence = {
		file,
		jobs: Object.keys(object(document.jobs)),
		events: workflowEvents(document),
		steps: [],
		roles: [],
		preparationJobs: [],
		reportingJobs: [],
		jobObstacles: jobObstacles(object(document.jobs)),
		prepares: false,
		reports: false,
		publishes: false,
	};
	for (const [job, value] of Object.entries(object(document.jobs))) {
		const steps = object(value).steps;
		if (!Array.isArray(steps)) continue;
		for (const entry of steps) {
			const step = object(entry), role = actionRole(step.uses), inputs = object(step.with);
			if (typeof step.id === 'string' && step.run) {
				result.steps.push({ job, id: step.id, label: String(step.name ?? step.id) });
			}
			if (
				role === 'begin' && typeof inputs.stream === 'string' && identifierPattern.test(inputs.stream)
				&& typeof inputs.operation === 'string' && identifierPattern.test(inputs.operation)
			) {
				result.roles.push({ job, stream: inputs.stream, operation: inputs.operation });
			}
			if (role === 'prepare') {
				result.prepares = true;
				if (!result.preparationJobs.includes(job)) result.preparationJobs.push(job);
			}
			if (role === 'report' || role === 'publish') {
				result.reports = true;
				if (!result.reportingJobs.includes(job)) result.reportingJobs.push(job);
			}
			if (
				typeof step.run === 'string'
				&& /\b(?:npm|pnpm|yarn|bun|jsr|cargo)\s+(?:[^\n]*\s)?publish\b|\bgoreleaser\s+release\b/.test(step.run)
			) result.publishes = true;
		}
	}
	const reports = (role: WorkflowEvidence['roles'][number]) =>
		role.operation === 'promote' && result.reportingJobs.includes(role.job);
	result.roles = result.roles.filter(role =>
		role.operation !== 'promote' || reports(role)
		|| !result.roles.some(other => other.stream === role.stream && reports(other))
	);
	return result;
}
