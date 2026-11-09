import type { Out } from '@kjanat/dreamcli';
import { CLIError, isCLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';

export function failure(message: string, code: string, suggest?: string): CLIError {
	return new CLIError(message, { code, ...(suggest === undefined ? {} : { suggest }) });
}
export function prompted<A>(run: () => Promise<A>): Effect.Effect<A, CLIError> {
	return Effect.tryPromise({
		try: run,
		catch: error =>
			isCLIError(error)
				? error
				: failure(error instanceof Error ? error.message : 'Could not read the answer', 'PROMPT_FAILED'),
	});
}
// dreamcli's ask throws PROMPT_UNAVAILABLE when stdin is no terminal and no answers are scripted.
export function unprompted<A, B, E>(
	question: Effect.Effect<A, CLIError>,
	fallback: () => Effect.Effect<B, E>,
): Effect.Effect<A | B, CLIError | E> {
	return question.pipe(Effect.catchIf(error => error.code === 'PROMPT_UNAVAILABLE', fallback));
}
export const signIn = 'Run beepboop auth login';
export function emit(out: Out, value: unknown): Effect.Effect<void> {
	return Effect.gen(function*() {
		const jq = out.isTTY && !out.jsonMode ? Bun.which('jq') : null;
		if (!jq) return out.json(value);
		const child = Bun.spawn([jq, ...(out.color.isColorSupported ? ['--color-output'] : []), '.'], {
			stdin: new Blob([JSON.stringify(value)]),
			stdout: 'pipe',
			stderr: 'inherit',
		});
		const [text, code] = yield* Effect.promise(() => Promise.all([new Response(child.stdout).text(), child.exited]));
		if (code !== 0) return out.json(value);
		out.log(text.trimEnd());
	});
}
