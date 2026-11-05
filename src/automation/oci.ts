import { Effect } from 'effect';
import type { Fetcher } from '@/automation/managers/registry';
import type { Outcome, Publication } from '@/automation/types';
import { fromPromise } from '@/failure';
import { record } from '@/model';

/** Public distribution verification. Never forwards GitHub or vault credentials to registries. */
export function verifyImage(publication: Publication, request: Fetcher = fetch): Effect.Effect<Publication> {
	const [, host, image] = publication.name.match(/^(ghcr\.io|docker\.io)\/([a-z0-9][a-z0-9._/-]*)$/) ?? [];
	if (!image || image.includes('..') || !/^[\w][\w.-]{0,127}$/.test(publication.version)) {
		return Effect.succeed({ ...publication, outcome: 'failed' });
	}
	const registry = host === 'docker.io' ? 'registry-1.docker.io' : 'ghcr.io';
	const url = `https://${registry}/v2/${image}/manifests/${encodeURIComponent(publication.version)}`;
	const headers: Record<string, string> = {
		Accept:
			'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
	};
	const result = (outcome: Outcome, digest?: string): Publication => ({
		...publication,
		outcome,
		url,
		...(digest === undefined ? {} : { digest }),
	});
	const manifest = () =>
		fromPromise(() => request(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }));
	return Effect.gen(function*() {
		let response = yield* manifest();
		if (response.status === 401) {
			const tokenUrl = new URL(registry === 'ghcr.io' ? 'https://ghcr.io/token' : 'https://auth.docker.io/token');
			tokenUrl.searchParams.set('service', registry === 'ghcr.io' ? 'ghcr.io' : 'registry.docker.io');
			tokenUrl.searchParams.set('scope', `repository:${image}:pull`);
			const auth = yield* fromPromise(() =>
				request(tokenUrl, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
			);
			if (!auth.ok) return result('uncertain');
			const data = yield* Effect.fromResult(record(yield* fromPromise((): Promise<unknown> => auth.json())));
			const token = data.token ?? data.access_token;
			if (typeof token !== 'string') return result('uncertain');
			headers.Authorization = `Bearer ${token}`;
			response = yield* manifest();
		}
		if (response.status === 404) return result('pending');
		if (!response.ok) return result('uncertain');
		const digest = response.headers.get('docker-content-digest');
		if (!digest || !/^sha256:[a-f0-9]{64}$/.test(digest) || !publication.digest || publication.digest !== digest) {
			return result('failed');
		}
		// Verify the bytes as well as the registry's digest header.
		const content = yield* fromPromise(() => response.arrayBuffer());
		if (content.byteLength > 4 * 1024 * 1024) return result('failed');
		const sum = yield* fromPromise(() => crypto.subtle.digest('SHA-256', content));
		const hash = Array.from(new Uint8Array(sum), (b) => b.toString(16).padStart(2, '0')).join('');
		if (digest !== `sha256:${hash}`) return result('failed');
		if (publication.channel) {
			const channel = yield* verifyImage({ ...publication, version: publication.channel, channel: undefined }, request);
			if (channel.outcome !== 'succeeded') {
				return { ...channel, version: publication.version, channel: publication.channel, url };
			}
		}
		return result('succeeded', digest);
	}).pipe(Effect.catchCause(() => Effect.succeed(result('uncertain'))));
}
