import { Effect } from 'effect';
import { githubApiVersion } from '@/github/transport.ts';
import { fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition, upstream } from '@/kernel/errors/domain-error.ts';
import { responseBytes, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';

export function copyReleaseAsset(
	transport: Fetcher,
	repository: string,
	asset: { id: number; name: string; contentType: string },
	releaseId: number,
	token: string,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const headers = {
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': githubApiVersion,
			'User-Agent': 'beepboop',
		};
		const download = yield* scopedResponse(
			fromPromise(signal =>
				transport(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, {
					headers: { ...headers, Accept: 'application/octet-stream' },
					signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
				})
			),
		);
		if (!download.ok) {
			const message = `GitHub HTTP ${download.status} downloading release asset ${asset.name}`;
			return yield* (download.status >= 500 ? upstream('github', message) : precondition(message));
		}
		const content = yield* responseBytes(download).pipe(Effect.mapError(({ cause }) => toDomainError(cause)));
		const upload = yield* scopedResponse(fromPromise(signal =>
			transport(
				`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${
					encodeURIComponent(asset.name)
				}`,
				{
					method: 'POST',
					headers: { ...headers, Accept: 'application/vnd.github+json', 'Content-Type': asset.contentType },
					body: content,
					signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
				},
			)
		));
		if (!upload.ok) {
			const message = `GitHub HTTP ${upload.status} uploading release asset ${asset.name}`;
			return yield* (upload.status >= 500 ? upstream('github', message) : precondition(message));
		}
	}).pipe(Effect.scoped);
}
