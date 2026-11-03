import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const root = resolve(import.meta.dir, '../../..');
const directory = resolve(root, 'packages/cli');
const manifest = z.object({ name: z.string(), version: z.string() });
const npm = manifest.parse(await Bun.file(`${directory}/package.json`).json());
const jsr = manifest.parse(await Bun.file(`${directory}/jsr.json`).json());
if (npm.name !== jsr.name || npm.version !== jsr.version) throw new Error('npm and JSR must share a name and version');
const result = await Bun.build({
	entrypoints: [resolve(root, 'src/cli/cli.ts')],
	outdir: directory,
	target: 'bun',
	format: 'esm',
	packages: 'external',
	naming: 'cli.js',
});
if (!result.success) throw new AggregateError(result.logs, 'CLI build failed');
await chmod(`${directory}/cli.js`, 0o755);
console.log(`Built ${npm.name}@${npm.version}`);
