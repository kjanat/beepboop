import { plugin } from 'bun';
import { mock } from 'bun:test';
import { astroPlugin } from '@root/test/support/astro.ts';
import * as workers from '@root/test/support/cloudflare-workers.ts';

// Git hooks export GIT_DIR and GIT_INDEX_FILE, which would redirect the tests' temporary repositories.
for (
	const name of [
		'GIT_DIR',
		'GIT_WORK_TREE',
		'GIT_INDEX_FILE',
		'GIT_OBJECT_DIRECTORY',
		'GIT_ALTERNATE_OBJECT_DIRECTORIES',
		'GIT_COMMON_DIR',
		'GIT_PREFIX',
		'GIT_NAMESPACE',
		'GIT_CEILING_DIRECTORIES',
		'GIT_DISCOVERY_ACROSS_FILESYSTEM',
		'GIT_QUARANTINE_PATH',
		'GIT_CONFIG',
		'GIT_CONFIG_GLOBAL',
		'GIT_CONFIG_SYSTEM',
		'GIT_CONFIG_NOSYSTEM',
		'GIT_CONFIG_COUNT',
		'GIT_CONFIG_PARAMETERS',
	]
) delete process.env[name];

mock.module('cloudflare:workers', () => workers);
mock.module('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
plugin(astroPlugin);
