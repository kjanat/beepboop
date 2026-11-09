import { readdir } from 'node:fs/promises';
import type { Effect } from 'effect';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise } from '@/tooling/runtime';

export function definitionFiles(directory: string): Effect.Effect<string[], ToolFailure> {
	return attemptPromise(async () =>
		(await readdir(directory)).filter(name => name.endsWith('-definition.json')).sort()
	);
}
