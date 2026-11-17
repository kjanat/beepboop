import type { RunJob } from '@/automation/job-gate';
import type { GitHubJobKind, GitHubRunState } from '@/contract/github';

const conclusions = {
	success: 'succeeded',
	failure: 'failed',
	cancelled: 'cancelled',
	skipped: 'skipped',
	neutral: 'neutral',
	timed_out: 'timed-out',
	action_required: 'action-required',
	startup_failure: 'startup-failure',
	stale: 'stale',
} as const satisfies Record<string, GitHubJobKind>;

function kind(status: unknown, conclusion: unknown): GitHubJobKind {
	if (status === 'completed') {
		return typeof conclusion === 'string' && Object.hasOwn(conclusions, conclusion)
			? conclusions[conclusion as keyof typeof conclusions]
			: 'unknown';
	}
	if (conclusion !== null && conclusion !== undefined) return 'unknown';
	if (status === 'in_progress') return 'running';
	if (['queued', 'requested', 'pending', 'waiting'].includes(String(status))) return 'waiting';
	return 'unknown';
}

export interface GitHubJobState {
	name: string;
	kind: GitHubJobKind;
	status: string;
	conclusion: string | null;
	completed: boolean;
	/** Missing fields are not evidence that GitHub never assigned a runner. */
	runner: 'assigned' | 'unassigned' | 'unknown';
}

export function classifyJob(job: RunJob): GitHubJobState {
	return {
		name: job.name,
		kind: kind(job.status, job.conclusion),
		status: job.status,
		conclusion: job.conclusion,
		completed: job.status === 'completed',
		runner: typeof job.runner_id === 'number' && job.runner_id > 0
			? 'assigned'
			: (job.runner_id === 0 || job.runner_id === null) && job.steps?.length === 0
			? 'unassigned'
			: 'unknown',
	};
}

/** Keep the original progress API decodable by already-installed clients. */
export function jobProgressState(kind: GitHubJobKind, completed: boolean) {
	switch (kind) {
		case 'waiting':
		case 'running':
		case 'succeeded':
		case 'skipped':
			return kind;
		case 'neutral':
			return 'skipped';
		case 'unknown':
			return completed ? 'failed' : 'waiting';
		default:
			return 'failed';
	}
}

export interface GitHubRunResult {
	observation: GitHubRunState;
	jobs: GitHubJobState[];
	/** A single failing job still needs a retryable ledger from this attempt. */
	retry: 'runner-unassigned' | 'ledger-required' | undefined;
}

/** Use the complete job list for this attempt, never a mixture of attempts. */
export function classifyRun(
	run: { status?: unknown; conclusion?: unknown },
	jobs: readonly RunJob[] = [],
): GitHubRunResult {
	const classified = jobs.map(classifyJob);
	const state = kind(run.status, run.conclusion);
	const benign = (job: GitHubJobState) => job.kind === 'succeeded' || job.kind === 'skipped';
	const failures = classified.filter(job => !benign(job));
	const stranded = state === 'failed' && failures.length > 0
		&& failures.every(job =>
			['failed', 'timed-out', 'cancelled'].includes(job.kind) && job.completed && job.runner === 'unassigned'
		);
	const ledgerRequired = (state === 'failed' || state === 'timed-out') && failures.length === 1
		&& failures.every(job => job.kind === 'failed' || job.kind === 'timed-out');
	return {
		observation: {
			kind: stranded ? 'runner-unassigned' : state,
			status: typeof run.status === 'string' ? run.status : null,
			conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
			completed: run.status === 'completed',
		},
		jobs: classified,
		retry: stranded ? 'runner-unassigned' : ledgerRequired ? 'ledger-required' : undefined,
	};
}

export function githubRunLabel(state: GitHubRunState): string {
	switch (state.kind) {
		case 'waiting':
			return `waiting on GitHub (${state.status})`;
		case 'running':
			return 'running on GitHub';
		case 'runner-unassigned':
			return 'GitHub failed before assigning a runner';
		case 'action-required':
			return 'GitHub requires action; check the workflow run';
		case 'startup-failure':
			return 'GitHub could not start the workflow';
		case 'timed-out':
			return 'GitHub workflow timed out';
		case 'unknown':
			return `unknown GitHub outcome (${state.status ?? 'no status'}/${state.conclusion ?? 'no conclusion'})`;
		default:
			return `GitHub workflow ${state.kind}`;
	}
}

export function githubFailureReason(result: GitHubRunResult): string {
	const failed = result.jobs.filter(job => job.kind !== 'succeeded' && job.kind !== 'skipped');
	const summary = githubRunLabel(result.observation);
	return failed.length ? `${summary}: ${failed.map(job => `${job.name} (${job.kind})`).join(', ')}` : summary;
}
