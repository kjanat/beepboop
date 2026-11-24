import type { Effect } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { npmDiscoverer } from '@/discovery/managers/npm.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import type { LookupOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import { latestVersion, unpublished, verifyRegistry } from '@/publication/registries/verification.ts';

export function npmLatest(name: string, request: Fetcher): Effect.Effect<LookupOutcome> {
	return latestVersion(
		request,
		`https://registry.npmjs.org/${encodeURIComponent(name)}`,
		body => {
			const latest = object(object(body)['dist-tags']).latest;
			const staged = typeof latest === 'string' && object(object(object(body).versions)[latest]).stub === true;
			return staged ? unpublished : latest;
		},
	);
}
export const npmManager: Adapter<'npm'> = {
	...npmDiscoverer,
	latest: (pkg, request) => npmLatest(pkg.name, request),
	verifyPublication(publication, request) {
		const url = `https://registry.npmjs.org/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(publication.version)
		}`;
		return verifyRegistry(
			publication,
			request,
			url,
			body => {
				const entry = object(body);
				return { name: entry.name, version: entry.version, digest: object(entry.dist).integrity };
			},
			publication.channel
				? `https://registry.npmjs.org/-/package/${encodeURIComponent(publication.name)}/dist-tags`
				: undefined,
		);
	},
};
