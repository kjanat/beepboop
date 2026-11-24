import { Effect } from 'effect';
import { commitSchema, comparisonSchema, repositorySchema } from '@/github/resources.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { sha } from '@/kernel/schema/result.ts';

export function defaultRevision(
	github: GitHubRequests,
	name: string,
	token: string,
): Effect.Effect<{ ref: string; sha: string }, DomainError> {
	return Effect.gen(function*() {
		const { default_branch: branch } = yield* github.read(repositorySchema, `/repos/${name}`, token);
		const commit = yield* github.read(commitSchema, `/repos/${name}/commits/${encodeURIComponent(branch)}`, token);
		return { ref: `refs/heads/${branch}`, sha: commit.sha };
	});
}

export function repositoryId(github: GitHubRequests, name: string, token: string): Effect.Effect<number, DomainError> {
	return github.read(repositorySchema, `/repos/${name}`, token).pipe(Effect.map(repository => repository.id));
}

export function contains(
	github: GitHubRequests,
	repository: string,
	commit: string,
	target: string,
	token: string,
): Effect.Effect<boolean, DomainError> {
	return Effect.gen(function*() {
		const comparison = yield* github.read(
			comparisonSchema,
			`/repos/${repository}/compare/${yield* Effect.fromResult(sha(commit))}...${yield* Effect.fromResult(
				sha(target),
			)}`,
			token,
		);
		return comparison.status === 'identical' || comparison.status === 'ahead';
	});
}
