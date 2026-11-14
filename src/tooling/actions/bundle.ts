import { join, resolve } from 'node:path';
import { Effect } from 'effect';
import { bundleRuntime, entrypoints } from '@/tooling/actions/runtime-bundle';
import { attempt, checkArguments, main, refuse, temporaryDirectory } from '@/tooling/runtime';

const verify = Effect.scoped(Effect.gen(function*() {
	const output = yield* temporaryDirectory('beepboop-actions-');
	yield* bundleRuntime(output);
	for (const entry of entrypoints) {
		const probe = yield* attempt(() =>
			Bun.spawnSync(['bun', '--no-install', join(output, `${entry}.ts`)], {
				cwd: output,
				env: { PATH: process.env.PATH ?? '', HOME: output },
				stdout: 'pipe',
				stderr: 'pipe',
			})
		);
		const report = `${probe.stdout.toString()}${probe.stderr.toString()}`;
		if (/Cannot find (module|package)/.test(report)) {
			return yield* refuse(`actions/runtime/${entry}.ts needs installed packages: ${report.trim()}`);
		}
		if (entry === 'client' && (probe.exitCode === 0 || !report.includes('Unknown integration action'))) {
			return yield* refuse(`The bundled action client did not reject its missing mode: ${report.trim()}`);
		}
	}
	console.log(`Bundled ${entrypoints.length} Actions runtime entrypoints without installed packages`);
}));

await main(Effect.gen(function*() {
	const { values, positionals } = yield* checkArguments(true);
	if (values.check) return yield* verify;
	const [output] = positionals;
	if (!output) return yield* refuse('Expected an output directory or --check');
	yield* bundleRuntime(resolve(output));
}));
