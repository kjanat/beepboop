import { Effect, Schema } from 'effect';
import { issueEventSchema } from '@/github/resources.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { looseStruct, mutableArray } from '@/kernel/schema/structs.ts';

const issueList = mutableArray(looseStruct({
	title: Schema.String,
	pull_request: Schema.optional(Schema.Unknown),
}));

export function ensureIssue(
	github: GitHubRequests,
	name: string,
	token: string,
	issue: { title: string; body: string },
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const path = `/repos/${name}/issues`;
		for (let page = 1;; page++) {
			const existing = yield* github.read(issueList, `${path}?state=all&per_page=100&page=${page}`, token);
			if (existing.some(candidate => !candidate.pull_request && candidate.title === issue.title)) return;
			if (existing.length < 100) break;
		}
		yield* github.call(path, token, 'POST', issue);
	});
}

export function mergeCommit(
	github: GitHubRequests,
	repository: string,
	number: string,
	token: string,
): Effect.Effect<string | undefined, DomainError> {
	return Effect.gen(function*() {
		for (let page = 1; page <= 10; page++) {
			const events = yield* github.read(
				mutableArray(issueEventSchema),
				`/repos/${repository}/issues/${number}/events?per_page=100&page=${page}`,
				token,
			);
			const merged = events.find((event) => event.event === 'merged');
			if (merged) return typeof merged.commit_id === 'string' ? merged.commit_id : undefined;
			if (events.length < 100) return undefined;
		}
		return undefined;
	});
}
