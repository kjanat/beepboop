import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { attemptPromise, refuse, type ToolFailure } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
export const entrypoints = ['client', 'prepare', 'refs'] as const;

export function bundleRuntime(output: string): Effect.Effect<void, ToolFailure> {
	return Effect.gen(function*() {
		yield* attemptPromise(() => mkdir(output, { recursive: true }));
		for (const entry of entrypoints) {
			const result = yield* attemptPromise(() =>
				Bun.build({
					entrypoints: [join(root, 'actions/runtime', `${entry}.ts`)],
					target: 'bun',
					format: 'esm',
					tsconfig: join(root, 'tsconfig.json'),
				})
			);
			const [artifact] = result.outputs;
			if (!result.success || !artifact) {
				return yield* refuse(`Cannot bundle actions/runtime/${entry}.ts: ${result.logs.join('\n')}`);
			}
			yield* attemptPromise(async () => Bun.write(join(output, `${entry}.ts`), await artifact.text()));
		}
	});
}
