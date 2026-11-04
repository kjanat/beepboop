import { plugin } from 'bun';
import { mock } from 'bun:test';
import { astroPlugin } from './support/astro.ts';
import * as workers from './support/cloudflare-workers.ts';

mock.module('cloudflare:workers', () => workers);
mock.module('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
plugin(astroPlugin);
