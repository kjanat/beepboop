import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { callLimit, liveJobs, ownWorkflow, workflowDocuments } from '@/discovery/release-graph/calls.ts';
import { isWorkflowPath, workflowPath } from '@/domain/workflow-path.ts';
import { comparisonSchema } from '@/github/resources.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { sha } from '@/kernel/schema/result.ts';

export function unchangedSince(
	gateway: RepositoryGateway,
	repository: string,
	repositoryId: number,
	commit: string,
	target: string,
	paths: ReadonlySet<string>,
): Effect.Effect<boolean, DomainError> {
	return Effect.gen(function*() {
		if (commit === target) return true;
		const token = yield* gateway.token(repository, repositoryId, { contents: 'read' });
		const comparison = yield* gateway.read(
			comparisonSchema,
			`/repos/${repository}/compare/${yield* Effect.fromResult(sha(commit))}...${yield* Effect.fromResult(
				sha(target),
			)}`,
			token,
		);
		if (comparison.status !== 'ahead' || comparison.files.length >= 300) return false;
		const changed = comparison.files.map(file => String(file.filename));
		if (changed.some(path => paths.has(path))) return false;
		if (!changed.some(isWorkflowPath)) return true;
		const called = yield* calledWorkflows(
			gateway,
			repository,
			[...paths].filter(isWorkflowPath),
			target,
			token,
		);
		return !changed.some(path => called.has(path));
	});
}
function calledWorkflows(
	gateway: RepositoryGateway,
	repository: string,
	roots: string[],
	commit: string,
	token: string,
): Effect.Effect<ReadonlySet<string>, DomainError> {
	return Effect.gen(function*() {
		const seen = new Set<string>();
		const queue = [...roots];
		for (let path = queue.shift(); path !== undefined && seen.size < callLimit; path = queue.shift()) {
			if (seen.has(path)) continue;
			seen.add(path);
			const source = yield* gateway.file(repository, path, commit, token);
			if (source === null) continue;
			for (const { document } of workflowDocuments([[path, source]])) {
				for (const [, job] of liveJobs(document)) {
					const callee = typeof job.uses === 'string' ? ownWorkflow(job.uses, repository) : undefined;
					if (callee) queue.push(workflowPath(callee.file));
				}
			}
		}
		return seen;
	});
}
