import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import type { DomainError } from '@/contract/errors';
import { outputEntry, writeOutput } from '@/tooling/github-output';
import { attemptPromise, ToolFailure } from '@/tooling/runtime';

export interface Rendered {
	name: string;
	content: string;
}

export function releaseChecksums(path: string): Effect.Effect<string, ToolFailure> {
	return attemptPromise(() => readFile(path, 'utf8'));
}

export function writeRendered(
	directory: string,
	rendered: Effect.Effect<Rendered, DomainError>,
	log: (line: string) => void,
): Effect.Effect<void, ToolFailure> {
	return Effect.gen(function*() {
		const { name, content } = yield* rendered.pipe(
			Effect.mapError(error => new ToolFailure({ message: error.detail ?? error.message, cause: error })),
		);
		const path = join(resolve(directory), name);
		yield* attemptPromise(() => writeFile(path, content, { flag: 'wx' }));
		log(path);
		const entry = process.env.GITHUB_OUTPUT
			? writeOutput('file', path)
			: Effect.fromResult(outputEntry('file', path)).pipe(Effect.flatMap(text =>
				Effect.sync(() => {
					process.stderr.write(text);
				})
			));
		yield* entry.pipe(Effect.mapError(error => new ToolFailure({ message: error.message, cause: error })));
	});
}
