import { Console, Effect, Schedule } from 'effect';
import { capture, checkArguments, main, parse, refuse } from '@/tooling/runtime.ts';
import { checkStates, CommentPages, completedReviews, outcome, PullRequestView } from './review.ts';

const repo = 'kjanat/beepboop';
const required = ['verify', 'CodeQL', 'browser'];

const poll = Effect.fn('poll')(function*(pr: string) {
	const view = yield* parse(
		PullRequestView,
		yield* capture(['gh', 'pr', 'view', pr, '--repo', repo, '--json', 'headRefOid,statusCheckRollup,mergeable']),
	);
	const pages = yield* parse(
		CommentPages,
		yield* capture(['gh', 'api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments`]),
	);
	const states = checkStates(view.statusCheckRollup, required);
	return { view, states, result: outcome(states, completedReviews(pages, view.headRefOid), view.mergeable) };
});

await main(Effect.gen(function*() {
	const { positionals: [pr] } = yield* checkArguments(true);
	if (!pr) return yield* refuse('Usage: wait.ts <pr>');
	const { view, states, result } = yield* poll(pr).pipe(Effect.repeat({
		schedule: Schedule.spaced('30 seconds'),
		times: 119,
		until: ({ result }) => result._tag !== 'Waiting',
	}));
	const head = view.headRefOid;
	if (result._tag === 'Reviewed') {
		yield* Console.log(JSON.stringify({ head, mergeable: view.mergeable, states, codex: result.codex }, null, 2));
	} else if (result._tag === 'Failed') {
		yield* Console.log(JSON.stringify({ head, failed: states }, null, 2));
	} else if (result._tag === 'Conflicting') {
		yield* Console.log('conflicting');
	} else {
		yield* Console.log('timeout');
	}
	const exit = result._tag === 'Waiting' ? 2 : result.exit;
	yield* Effect.sync(() => {
		process.exitCode = exit;
	});
}));
