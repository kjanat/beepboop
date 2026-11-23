import { Effect } from 'effect';
import { jsrDiscoverer } from '@/discovery/managers/jsr.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { jsrPackageNamePattern } from '@/domain/catalog.ts';
import { fromJson, fromPromise } from '@/kernel/errors/classify.ts';
import { responseBytes, responseJson, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import { latestVersion, publicationResult, unconfirmed, unpublished } from '@/publication/registries/verification.ts';

export function jsrLatest(name: string, request: Fetcher): Effect.Effect<VerificationOutcome> {
	if (!jsrPackageNamePattern.test(name)) {
		return Effect.succeed(
			VerificationOutcome.LookupFailed({ url: 'https://jsr.io', reason: 'Invalid JSR package name' }),
		);
	}
	return latestVersion(request, `https://jsr.io/${name}/meta.json`, body => {
		const metadata = object(body);
		const [scope, bare] = name.slice(1).split('/');
		const latest = metadata.latest;
		if (
			metadata.scope === scope && metadata.name === bare && latest === null
			&& !Object.keys(object(metadata.versions)).length
		) return unpublished;
		return metadata.scope === scope && metadata.name === bare && typeof latest === 'string'
				&& Object.hasOwn(object(metadata.versions), latest)
				&& object(object(metadata.versions)[latest]).yanked !== true
			? latest
			: undefined;
	});
}
export const jsrManager: Adapter<'jsr'> = {
	...jsrDiscoverer,
	latest: (pkg, request) => jsrLatest(pkg.name, request),
	verifyPublication(publication, request) {
		if (!jsrPackageNamePattern.test(publication.name) || !/^[0-9A-Za-z.+-]+$/.test(publication.version)) {
			return Effect.succeed({ ...publication, outcome: 'failed' });
		}
		const url = `https://jsr.io/${publication.name}/${publication.version}_meta.json`;
		const options = {
			redirect: 'manual' as const,
			signal: AbortSignal.timeout(15_000),
			headers: { Accept: 'application/json' },
		};
		const result = publicationResult(publication, url);
		return Effect.gen(function*() {
			const metadata = yield* scopedResponse(
				fromPromise(signal =>
					request(`https://jsr.io/${publication.name}/meta.json`, {
						...options,
						signal: AbortSignal.any([signal, options.signal]),
					})
				),
			);
			const absent = unconfirmed(metadata);
			if (absent) return result(absent);
			const body = object(yield* responseJson(metadata));
			const [scope, name] = publication.name.slice(1).split('/');
			if (body.scope !== scope || body.name !== name) return result('failed');
			if (!Object.hasOwn(object(body.versions), publication.version)) return result('pending');
			if (object(object(body.versions)[publication.version]).yanked === true) return result('failed');
			const response = yield* scopedResponse(
				fromPromise(signal => request(url, { ...options, signal: AbortSignal.any([signal, options.signal]) })),
			);
			const missing = unconfirmed(response);
			if (missing) return result(missing);
			const bytes = yield* responseBytes(response);
			const version = object(yield* fromJson(new TextDecoder().decode(bytes)));
			const files = Object.values(object(version.manifest));
			if (
				!files.length || !Object.keys(object(version.exports)).length
				|| files.some(file => !/^sha256-[a-f0-9]{64}$/.test(String(object(file).checksum)))
			) {
				return result('failed');
			}
			const digest = `sha256-${yield* fromPromise(() => sha256Hex(bytes.buffer))}`;
			return result(publication.digest && publication.digest !== digest ? 'failed' : 'succeeded', digest);
		}).pipe(Effect.scoped, Effect.orElseSucceed(() => result('uncertain')));
	},
};
