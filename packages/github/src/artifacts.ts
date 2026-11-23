import type { Effect } from 'effect';
import { githubApiVersion } from '@/github/transport.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';

export function downloadWorkflowArtifact(
	transport: Fetcher,
	repository: string,
	id: number,
	token: string,
): Effect.Effect<Uint8Array, DomainError> {
	return fromPromise(async signal => {
		const redirected = await transport(
			`https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					'X-GitHub-Api-Version': githubApiVersion,
					'User-Agent': 'beepboop',
				},
				signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
				redirect: 'manual',
			},
		);
		const location = redirected.headers.get('location');
		await redirected.body?.cancel();
		if (redirected.status !== 302 || !location) {
			throw precondition('GitHub did not provide a distribution artifact download URL');
		}
		const url = new URL(location);
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw precondition('Invalid distribution artifact download URL');
		}
		const response = await transport(url.href, {
			signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
			redirect: 'error',
		});
		if (!response.ok || !response.body) {
			throw precondition(`GitHub HTTP ${response.status} downloading distribution artifact`);
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.byteLength;
				if (size > 8 * 1024 * 1024) throw precondition('Distribution artifact exceeds 8 MiB');
				chunks.push(next.value);
			}
		} finally {
			await reader.cancel();
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	});
}
