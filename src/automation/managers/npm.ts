import type { Effect } from 'effect';
import type { Adapter, RegistryVersion } from '@/automation/managers/registry';
import { latestVersion, unpublished, verifyRegistry } from '@/automation/managers/verification';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { npmDiscoverer } from '@/discovery/managers/npm.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';

export function npmLatest(name: string, request: Fetcher): Effect.Effect<RegistryVersion> {
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
