import { join } from 'node:path';
import { transform } from '@astrojs/compiler-rs';
import type { BunPlugin } from 'bun';

const runtime = join(import.meta.dir, 'astro-runtime.ts');

export const astroPlugin: BunPlugin = {
	name: 'astro components',
	setup(build) {
		build.onLoad({ filter: /\.astro$/ }, async args => {
			const result = transform(await Bun.file(args.path).text(), {
				filename: args.path,
				internalURL: runtime,
				resultScopedSlot: true,
			});
			const error = result.diagnostics.find(diagnostic => diagnostic.severity === 'error');
			if (error) throw new Error(`${args.path}: ${error.text}`);
			return { contents: result.code, loader: 'ts' };
		});
		build.onLoad({ filter: /\.(png|svg|ico)$/ }, args => ({
			contents: `export default ${
				JSON.stringify({ src: `/_astro/${args.path.split('/').at(-1)}`, width: 36, height: 36, format: 'png' })
			};`,
			loader: 'js',
		}));
		build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
	},
};
