import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { build } from 'tsdown';
import { packageManifest } from '@/tooling/cli/manifest';
import { attemptPromise, main, parse, readJson, refuse } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');

await main(Effect.gen(function*() {
	const npm = yield* parse(packageManifest, yield* readJson(`${directory}/package.json`));
	const jsr = yield* parse(packageManifest, yield* readJson(`${directory}/jsr.json`));
	if (npm.name !== jsr.name || npm.version !== jsr.version) {
		return yield* refuse('npm and JSR must share a name and version');
	}
	yield* attemptPromise(() =>
		build({
			cwd: directory,
			entry: { cli: resolve(root, 'src/cli/cli.ts') },
			tsconfig: resolve(root, 'tsconfig.json'),
			outDir: directory,
			format: 'esm',
			platform: 'node',
			clean: false,
			dts: false,
			outExtensions: () => ({ js: '.js' }),
			deps: { neverBundle: [/^bun:/], onlyImport: ['@kjanat/dreamcli', /^bun:/] },
		})
	);
	yield* attemptPromise(() => chmod(`${directory}/cli.js`, 0o755));
	console.log(`Built ${npm.name}@${npm.version}`);
}));
