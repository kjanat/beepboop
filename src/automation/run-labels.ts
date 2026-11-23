import type { GitHubJobKind, GitHubRunState } from '@/contract/github';

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

export function githubFailureReason(result: {
	observation: GitHubRunState;
	jobs: readonly { name: string; kind: GitHubJobKind }[];
}): string {
	const failed = result.jobs.filter(job => job.kind !== 'succeeded' && job.kind !== 'skipped');
	const summary = githubRunLabel(result.observation);
	return failed.length ? `${summary}: ${failed.map(job => `${job.name} (${job.kind})`).join(', ')}` : summary;
}
