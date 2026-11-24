import { Effect, Result } from 'effect';
import { cargoDiscoverer } from '@/discovery/managers/cargo.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { compareVersions, isPrerelease } from '@/domain/semver.ts';
import { responseText } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import type { Publication } from '@/publication/publication.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import {
	checkOutcomes,
	LookupFailure,
	latestText,
	latestVersion,
	registryRequest,
	unconfirmed,
	unpublished,
	verificationFailure,
	verifyRegistry,
} from '@/publication/registries/verification.ts';
export function crateIndexUrl(name: string): string {
	const lower = name.toLowerCase();
	const path = lower.length <= 2
		? `${lower.length}/${lower}`
		: lower.length === 3
		? `3/${lower[0]}/${lower}`
		: `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`;
	return `https://index.crates.io/${path}`;
}
function indexLatest(body: string): unknown {
	const entries = body.split('\n').filter(line => line.trim()).map(line => Result.try(() => object(JSON.parse(line))));
	if (entries.some(Result.isFailure)) return new LookupFailure('invalid registry response');
	const versions = entries.flatMap(entry =>
		Result.isSuccess(entry) && entry.success.yanked === false && typeof entry.success.vers === 'string'
			? [entry.success.vers]
			: []
	);
	const stable = versions.filter(version => !isPrerelease(version));
	const candidates = stable.length ? stable : versions;
	return candidates.reduce<string | undefined>(
		(best, version) => best === undefined || compareVersions(version, best) > 0 ? version : best,
		undefined,
	) ?? unpublished;
}
function verifyIndex(publication: Publication, request: Fetcher): Effect.Effect<CheckOutcome> {
	const url = crateIndexUrl(publication.name);
	const result = checkOutcomes(publication, url);
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url);
		const missing = unconfirmed(response, url);
		if (missing) return missing;
		const lines = (yield* responseText(response)).split('\n').filter(line => line.trim());
		const entries = lines.map(line => Result.try(() => object(JSON.parse(line))));
		if (entries.some(Result.isFailure)) return result.failed('invalid registry response');
		const entry =
			entries.flatMap(parsed =>
				Result.isSuccess(parsed) && parsed.success.vers === publication.version ? [parsed.success] : []
			)[0];
		if (!entry) return result.pending();
		const digest = entry.cksum;
		if (
			entry.name !== publication.name || entry.yanked !== false || typeof digest !== 'string' || !digest
			|| (publication.digest && publication.digest !== digest)
		) {
			return result.rejected();
		}
		return result.published(digest);
	}).pipe(Effect.scoped, Effect.orElseSucceed(() => result.failed(verificationFailure)));
}
export const cargoManager = {
	...cargoDiscoverer,
	latest(pkg, request) {
		return latestVersion(
			request,
			`https://crates.io/api/v1/crates/${encodeURIComponent(pkg.name)}`,
			body => {
				const crate = object(object(body).crate);
				return crate.max_stable_version ?? crate.max_version;
			},
		).pipe(
			Effect.filterOrElse(
				found => found._tag !== 'LookupFailed',
				() => latestText(request, crateIndexUrl(pkg.name), indexLatest),
			),
		);
	},
	verifyPublication(publication, request) {
		const url = `https://crates.io/api/v1/crates/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(publication.version)
		}`;
		return verifyRegistry(publication, request, url, body => {
			const entry = object(object(body).version);
			return { name: entry.crate, version: entry.num, withdrawn: entry.yanked !== false, digest: entry.checksum };
		}).pipe(
			Effect.filterOrElse(
				verified => verified._tag !== 'LookupFailed',
				() => verifyIndex(publication, request),
			),
		);
	},
} satisfies Adapter<'cargo'>;
