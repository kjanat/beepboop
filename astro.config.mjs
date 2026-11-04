import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
	output: 'server',
	compressHTML: true,
	devToolbar: { enabled: false },
	session: false,
	server: { host: 'localhost', port: 4321 },
	vite: { server: { strictPort: true } },
	adapter: cloudflare({ imageService: 'passthrough' }),
});
