import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import type { WorkflowRun } from '@/github/resources.ts';
import { workflowJobsSchema } from '@/github/resources.ts';
import type { RunJob } from '@/github/run-state.ts';

export const runJobs = Effect.fnUntraced(function*(
	gateway: RepositoryGateway,
	repository: string,
	run: Pick<WorkflowRun, 'id' | 'run_attempt'>,
	token: string,
) {
	const jobs: RunJob[] = [];
	for (let page = 1;; page++) {
		const listed = yield* gateway.read(
			workflowJobsSchema,
			`/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
			token,
		);
		jobs.push(...listed.jobs);
		if (!listed.jobs.length || jobs.length >= listed.total_count) return jobs;
	}
});
