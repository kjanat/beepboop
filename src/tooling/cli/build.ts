import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { build } from 'tsdown';
import { generatedJsr, packageManifest } from '@/tooling/cli/manifest';
import { attemptPromise, main, parse, readJson } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');

await main(Effect.gen(function*() {
	const npm = yield* parse(packageManifest, yield* readJson(`${directory}/package.json`));
	const jsrPath = `${directory}/jsr.json`;
	const source = yield* attemptPromise(() => Bun.file(jsrPath).text());
	const generated = yield* generatedJsr(npm, source);
	if (generated !== source) {
		yield* attemptPromise(() => Bun.write(jsrPath, generated));
		console.log(`Wrote version ${npm.version} from package.json to jsr.json`);
	}
	yield* attemptPromise(() =>
		build({
			cwd: directory,
			entry: { cli: resolve(directory, 'src/main.ts') },
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
