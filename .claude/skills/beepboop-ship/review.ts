import { Duration, Effect, Option, Schedule, Schema } from 'effect';
import type { ToolFailure } from '@/tooling/runtime.ts';
import { capture, parse } from '@/tooling/runtime.ts';

export const codexLogin = 'chatgpt-codex-connector[bot]';

export const PullRequestView = Schema.fromJsonString(Schema.Struct({
	headRefOid: Schema.String,
	mergeable: Schema.String,
	statusCheckRollup: Schema.Array(Schema.Struct({
		name: Schema.optional(Schema.String),
		context: Schema.optional(Schema.String),
		status: Schema.optional(Schema.String),
		conclusion: Schema.optional(Schema.String),
		state: Schema.optional(Schema.String),
	})),
}));

export const CommentPages = Schema.fromJsonString(Schema.Array(Schema.Array(Schema.Struct({
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
	| { _tag: 'Conflicting'; exit: 4 }
	| { _tag: 'Reviewed'; exit: 0 | 3; codex: CodexState };

export function checkStates(
	rollup: typeof PullRequestView.Type['statusCheckRollup'],
	required: readonly string[],
): CheckState[] {
	return required.map(name => {
		const check = rollup.find(c => (c.name ?? c.context) === name);
		return { name, status: check?.status ?? check?.state ?? 'missing', conclusion: check?.conclusion ?? '' };
	});
}

export function completedReviews(pages: typeof CommentPages.Type, head: string): CodexState[] {
	return pages
		.flat()
		.filter(comment => comment.user?.login === codexLogin)
		.flatMap(comment => [...comment.body.matchAll(/codex-review-state:v1\s*(\{.*?\})\s*-->/gs)])
		.flatMap(match => Option.toArray(Schema.decodeUnknownOption(CodexState)(match[1])))
		.filter(state => state.code_review.commit_sha === head && state.code_review.status === 'completed');
}

export function outcome(
	states: readonly CheckState[],
	reviews: readonly CodexState[],
	mergeable: string,
): Outcome {
	if (mergeable === 'CONFLICTING') return { _tag: 'Conflicting', exit: 4 };
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

const repo = 'kjanat/beepboop';
const required = ['verify', 'CodeQL', 'browser'];

export type Gh = (args: string[]) => Effect.Effect<string, ToolFailure>;

export const gh: Gh = args => capture(['gh', ...args]);

export const ghBackoff = Schedule.exponential('2 seconds').pipe(
	Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
);

export const ghAttempts = 5;

function retried<A>(effect: Effect.Effect<A, ToolFailure>) {
	return effect.pipe(Effect.retry({ schedule: ghBackoff, times: ghAttempts - 1 }));
}

export const poll = Effect.fn('poll')(function*(pr: string, run: Gh) {
	const view = yield* retried(
		Effect.suspend(() => run(['pr', 'view', pr, '--repo', repo, '--json', 'headRefOid,statusCheckRollup,mergeable']))
			.pipe(
				Effect.flatMap(text => parse(PullRequestView, text)),
			),
	);
	const pages = yield* retried(
		Effect.suspend(() => run(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`])).pipe(
			Effect.flatMap(text => parse(CommentPages, text)),
		),
	);
	const states = checkStates(view.statusCheckRollup, required);
	return { view, states, result: outcome(states, completedReviews(pages, view.headRefOid), view.mergeable) };
});

export const waitFor = Effect.fn('waitFor')(function*(pr: string, run: Gh) {
	const { view, states, result } = yield* poll(pr, run).pipe(Effect.repeat({
		schedule: Schedule.spaced('30 seconds'),
		times: 119,
		until: ({ result }) => result._tag !== 'Waiting',
	}));
	const head = view.headRefOid;
	if (result._tag === 'Reviewed') {
		return {
			exit: result.exit,
			output: JSON.stringify({ head, mergeable: view.mergeable, states, codex: result.codex }, null, 2),
		};
	}
	if (result._tag === 'Failed') return { exit: result.exit, output: JSON.stringify({ head, failed: states }, null, 2) };
	if (result._tag === 'Conflicting') return { exit: result.exit, output: 'conflicting' };
	return { exit: 2, output: 'timeout' };
}, Effect.catchTag('ToolFailure', failure => Effect.succeed({ exit: 5, output: `gh error: ${failure.message}` })));
