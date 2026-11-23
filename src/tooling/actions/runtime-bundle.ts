import { mkdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Effect } from 'effect';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, refuse } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
export const entrypoints = [
	'client',
	'generate-homebrew',
	'generate-scoop',
	'generate-winget',
	'prepare',
	'publish',
	'pull-request',
	'refs',
] as const;

function withoutModuleComments(bundle: string): string {
	return bundle.replace(/^\/\/ [\w@.+/-]+\.(?:[cm]?[jt]sx?|json)\n/gm, '');
}

export function bundleRuntime(output: string): Effect.Effect<void, ToolFailure> {
	return Effect.gen(function*() {
		yield* attemptPromise(() => mkdir(output, { recursive: true }));
		const result = yield* attemptPromise(() => Bun.build({
			entrypoints: entrypoints.map(entry => join(root, 'packages/actions/src', `${entry}.ts`)),
			target: 'bun',
			format: 'esm',
			naming: '[name].ts',
			tsconfig: join(root, 'tsconfig.json'),
		}));
		if (!result.success || result.outputs.length !== entrypoints.length) {
			return yield* refuse(`Bundling action runtimes failed: ${result.logs.join('\n')}`);
		}
		for (const artifact of result.outputs) {
			yield* attemptPromise(async () =>
				Bun.write(join(output, basename(artifact.path)), withoutModuleComments(await artifact.text()))
			);
		}
	});
}
