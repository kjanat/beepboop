import type { Out } from '@kjanat/dreamcli';
import { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';

export function failure(message: string, code: string, suggest?: string): CLIError {
	return new CLIError(message, { code, ...(suggest === undefined ? {} : { suggest }) });
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
export function emitTable<T, R extends Record<string, unknown>>(
	out: Out,
	value: T,
	rows: (value: T) => readonly R[],
): Effect.Effect<void> {
	return out.jsonMode ? emit(out, value) : Effect.sync(() => out.table(rows(value)));
}
