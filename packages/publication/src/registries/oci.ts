import { Effect } from 'effect';
import { fromPromise } from '@/kernel/errors/classify.ts';
import { responseBytes, responseJson } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { sha256DigestPattern, sha256Hex } from '@/kernel/schema/ids.ts';
import { record } from '@/kernel/schema/result.ts';
import type { Publication } from '@/publication/publication.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import { checkOutcomes, verificationFailure } from '@/publication/registries/verification.ts';

/** Public distribution verification. Never forwards GitHub or vault credentials to registries. */
export function verifyImage(publication: Publication, request: Fetcher = platformFetch): Effect.Effect<CheckOutcome> {
	const [, host, image] = publication.name.match(/^(ghcr\.io|docker\.io)\/([a-z0-9][a-z0-9._/-]*)$/) ?? [];
	if (!image || image.includes('..') || !/^[\w][\w.-]{0,127}$/.test(publication.version)) {
		return Effect.succeed(VerificationOutcome.Rejected({}));
	}
	const registry = host === 'docker.io' ? 'registry-1.docker.io' : 'ghcr.io';
	const url = `https://${registry}/v2/${image}/manifests/${encodeURIComponent(publication.version)}`;
	const headers: Record<string, string> = {
		Accept:
			'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
	};
	const result = checkOutcomes(publication, url);
	const manifest = () =>
		fromPromise(signal =>
			request(url, { headers, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
		);
	return Effect.gen(function*() {
		let response = yield* manifest();
		if (response.status === 401) {
			const tokenUrl = new URL(registry === 'ghcr.io' ? 'https://ghcr.io/token' : 'https://auth.docker.io/token');
			tokenUrl.searchParams.set('service', registry === 'ghcr.io' ? 'ghcr.io' : 'registry.docker.io');
			tokenUrl.searchParams.set('scope', `repository:${image}:pull`);
			const auth = yield* fromPromise(signal =>
				request(tokenUrl, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
			);
			if (!auth.ok) return result.failed(`HTTP ${auth.status}`);
			const data = yield* Effect.fromResult(record(yield* responseJson(auth)));
			const token = data.token ?? data.access_token;
			if (typeof token !== 'string') return result.failed('no registry token');
			headers.Authorization = `Bearer ${token}`;
			response = yield* manifest();
		}
		if (response.status === 404) return result.pending();
		if (!response.ok) return result.failed(`HTTP ${response.status}`);
		const digest = response.headers.get('docker-content-digest');
		if (!digest || !sha256DigestPattern.test(digest) || !publication.digest || publication.digest !== digest) {
			return result.rejected();
		}
		// Verify the bytes as well as the registry's digest header.
		const content = yield* responseBytes(response);
		if (content.byteLength > 4 * 1024 * 1024) return result.rejected();
		const hash = yield* fromPromise(() => sha256Hex(content.buffer));
		if (digest !== `sha256:${hash}`) return result.rejected();
		if (publication.channel) {
			const channel = yield* verifyImage({ ...publication, version: publication.channel, channel: undefined }, request);
			if (channel._tag !== 'Published') return { ...channel, url };
		}
		return result.published(digest);
	}).pipe(Effect.orElseSucceed(() => result.failed(verificationFailure)));
}
