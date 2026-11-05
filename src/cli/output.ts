import { CLIError, type Out } from '@kjanat/dreamcli';
import { Effect } from 'effect';

export function failure(message: string, code: string, suggest?: string): CLIError {
	return new CLIError(message, { code, ...(suggest === undefined ? {} : { suggest }) });
}
export const signIn = 'Run beepboop auth login';
export function emit(out: Out, value: unknown): Effect.Effect<void> {
	return Effect.gen(function*() {
		const jq = process.stdout.isTTY ? Bun.which('jq') : null;
		if (!jq) return out.json(value);
		const child = Bun.spawn([jq, '.'], {
			stdin: new Blob([JSON.stringify(value)]),
			stdout: 'inherit',
			stderr: 'inherit',
		});
		if ((yield* Effect.promise(() => child.exited)) !== 0) out.json(value);
	});
}
