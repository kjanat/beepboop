import { plugin } from 'bun';
import { mock } from 'bun:test';
import { astroPlugin } from '@root/test/support/astro.ts';
import * as workers from '@root/test/support/cloudflare-workers.ts';

// Git hooks export GIT_DIR and GIT_INDEX_FILE, which would redirect the tests' temporary repositories.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];

mock.module('cloudflare:workers', () => workers);
mock.module('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
plugin(astroPlugin);
