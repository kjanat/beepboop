import { Option, Schema } from 'effect';

export const codexLogin = 'chatgpt-codex-connector[bot]';

const CommentPages = Schema.fromJsonString(Schema.Array(Schema.Array(Schema.Struct({
	body: Schema.String,
	user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
}))));

const CodexState = Schema.fromJsonString(Schema.Struct({
	code_review: Schema.Struct({
		commit_sha: Schema.String,
		status: Schema.String,
		has_any_findings: Schema.NullOr(Schema.Boolean),
	}),
}));

export type CodexState = typeof CodexState.Type;

export type CheckState = { name: string; status: string; conclusion: string };

export type Outcome =
	| { _tag: 'Waiting' }
	| { _tag: 'Failed'; exit: 1 }
	| { _tag: 'Reviewed'; exit: 0 | 3; codex: CodexState };

export function completedReviews(pages: string, head: string): CodexState[] {
	return Schema.decodeSync(CommentPages)(pages)
		.flat()
		.filter(comment => comment.user?.login === codexLogin)
		.flatMap(comment => [...comment.body.matchAll(/codex-review-state:v1\s*(\{.*?\})\s*-->/gs)])
		.flatMap(match => Option.toArray(Schema.decodeUnknownOption(CodexState)(match[1])))
		.filter(state => state.code_review.commit_sha === head && state.code_review.status === 'completed');
}

export function outcome(states: readonly CheckState[], reviews: readonly CodexState[]): Outcome {
	const checksDone = states.every(state =>
		state.status === 'COMPLETED' || state.status === 'SUCCESS' || state.status === 'FAILURE'
	);
	const codex = reviews.at(-1);
	if (checksDone && codex) {
		return { _tag: 'Reviewed', exit: codex.code_review.has_any_findings === false ? 0 : 3, codex };
	}
	if (states.some(state => state.conclusion === 'FAILURE')) return { _tag: 'Failed', exit: 1 };
	return { _tag: 'Waiting' };
}
