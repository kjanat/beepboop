import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'tsdown';
import { z } from 'zod';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');
const manifest = z.object({ name: z.string(), version: z.string() });
const npm = manifest.parse(await Bun.file(`${directory}/package.json`).json());
const jsr = manifest.parse(await Bun.file(`${directory}/jsr.json`).json());
if (npm.name !== jsr.name || npm.version !== jsr.version) throw new Error('npm and JSR must share a name and version');
await build({
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
});
await chmod(`${directory}/cli.js`, 0o755);
console.log(`Built ${npm.name}@${npm.version}`);
