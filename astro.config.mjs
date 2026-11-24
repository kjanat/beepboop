import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
	output: 'server',
	compressHTML: true,
	devToolbar: { enabled: false },
	session: false,
	server: { host: 'localhost', port: 4321 },
	vite: {
		server: { strictPort: true },
		environments: {
			ssr: {
				// Run SimpleWebAuthn's Reflect polyfill before its X.509 dependency.
				build: { rolldownOptions: { output: { strictExecutionOrder: true } } },
			},
		},
	},
	adapter: cloudflare({ imageService: 'passthrough' }),
});
