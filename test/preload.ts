import { mock, setDefaultTimeout } from 'bun:test';
import { astroPlugin } from '@root/test/support/astro.ts';
import * as workers from '@root/test/support/cloudflare-workers.ts';
import { repositoryVariablesIn } from '@root/test/support/git-environment.ts';
import { plugin } from 'bun';

const inherited = repositoryVariablesIn(process.env);
if (inherited.length) {
	throw new Error(
		`Tests spawn git, and ${
			inherited.join(', ')
		} would point it at this repository. Run them through \`bun run test\`, which starts bun test without these variables.`,
	);
}

mock.module('cloudflare:workers', () => workers);
mock.module('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
plugin(astroPlugin);
setDefaultTimeout(50_000);
