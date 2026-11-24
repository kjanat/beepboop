import { Console, Effect } from 'effect';
import { checkArguments, main, refuse } from '@/tooling/runtime.ts';
import { gh, waitFor } from './review.ts';

await main(Effect.gen(function*() {
	const { positionals: [pr] } = yield* checkArguments(true);
	if (!pr) return yield* refuse('Usage: wait.ts <pr>');
	const { exit, output } = yield* waitFor(pr, gh);
	yield* Console.log(output);
	yield* Effect.sync(() => {
		process.exitCode = exit;
	});
}));
