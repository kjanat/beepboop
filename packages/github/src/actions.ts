import { Effect } from 'effect';
import { workflowRunSchema } from '@/github/resources.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

export function workflowRun(
	github: GitHubRequests,
	repository: { name: string; id: number },
	runId: number,
	token: string,
): Effect.Effect<{ title: string; path: string }, DomainError> {
	return Effect.gen(function*() {
		const run = yield* github.read(workflowRunSchema, `/repos/${repository.name}/actions/runs/${runId}`, token);
		if (run.repository.id !== repository.id) return yield* precondition('Run identity changed');
		return { title: run.display_title, path: run.path };
	});
}
