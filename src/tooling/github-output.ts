import { appendFileSync } from 'node:fs';
import { Data, Effect, Result } from 'effect';

export class OutputFailure extends Data.TaggedError('OutputFailure')<{ readonly message: string }> {}

export function outputEntry(name: string, value: string): Result.Result<string, OutputFailure> {
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
		return Result.fail(new OutputFailure({ message: `Invalid output name: ${name}` }));
	}
	const marker = `value_${crypto.randomUUID()}`;
	return Result.succeed(`${name}<<${marker}\n${value}\n${marker}\n`);
}

export function writeOutput(name: string, value: string): Effect.Effect<void, OutputFailure> {
	return Effect.suspend(() => writeOutputTo(process.env.GITHUB_OUTPUT, name, value));
}

export function writeOutputTo(
	file: string | undefined,
	name: string,
	value: string,
): Effect.Effect<void, OutputFailure> {
	return Effect.gen(function*() {
		if (!file) return yield* new OutputFailure({ message: 'GITHUB_OUTPUT is required' });
		const entry = yield* Effect.fromResult(outputEntry(name, value));
		yield* Effect.try({
			try: () => appendFileSync(file, entry),
			catch: error => new OutputFailure({ message: error instanceof Error ? error.message : String(error) }),
		});
	});
}
