import { Effect } from 'effect';
import { goDiscoverer, splitModulePath } from '@/discovery/managers/go.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { responseJson } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { ioConcurrency } from '@/kernel/http/retry.ts';
import type { Publication } from '@/publication/publication.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import {
	checkOutcomes,
	latestVersion,
	registryRequest,
	unconfirmed,
	verificationFailure,
} from '@/publication/registries/verification.ts';

export function escapeModule(value: string): string {
	return value.replace(/[A-Z]/g, letter => `!${letter.toLowerCase()}`);
}
function verifyModule(publication: Publication, request: Fetcher): Effect.Effect<CheckOutcome> {
	const version = `v${publication.version.replace(/^v/, '')}`;
	const url = `https://proxy.golang.org/${escapeModule(publication.name)}/@v/${escapeModule(version)}.info`;
	const result = checkOutcomes(publication, url);
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url);
		if (response.status === 410) return result.pending();
		const missing = unconfirmed(response, url);
		if (missing) return missing;
		const info = object(yield* responseJson(response));
		const hash = object(info.Origin).Hash;
		if (info.Version !== version || (publication.digest && typeof hash === 'string' && hash !== publication.digest)) {
			return result.rejected();
		}
		if (typeof hash !== 'string') return publication.digest ? result.failed('no origin hash') : result.published();
		return result.published(hash);
	}).pipe(Effect.scoped, Effect.orElseSucceed(() => result.failed(verificationFailure)));
}

export const goManager: Adapter<'go'> = {
	...goDiscoverer,
	latest(pkg, request) {
		const split = splitModulePath(pkg.name);
		const lookup = (name: string) =>
			latestVersion(
				request,
				`https://proxy.golang.org/${escapeModule(name)}/@latest`,
				body => {
					const version = object(body).Version;
					const module = splitModulePath(name);
					return typeof version === 'string' && /^v\d/.test(version)
							&& module?.majors.includes(Number(version.slice(1).split('.')[0]))
						? version
						: undefined;
				},
			);
		return Effect.all([lookup(pkg.name), split?.suffix ? lookup(split.prefix) : Effect.undefined], {
			concurrency: ioConcurrency,
		}).pipe(Effect.map(([current, previous]) =>
			previous?._tag === 'Published' && split
				? { ...current, previousModule: { name: split.prefix, version: previous.version } }
				: current
		));
	},
	verifyPublication: verifyModule,
};
