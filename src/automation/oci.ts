import type { Fetcher } from './managers.ts';
import type { Publication } from './types.ts';

/** Public distribution verification. Never forwards GitHub or vault credentials to registries. */
export async function verifyImage(
	publication: Publication,
	request: Fetcher = fetch,
): Promise<Publication> {
	const match = publication.name.match(/^(ghcr\.io|docker\.io)\/([a-z0-9][a-z0-9._/-]*)$/);
	if (!match || match[2]?.includes('..') || !/^[\w][\w.-]{0,127}$/.test(publication.version)) {
		return { ...publication, outcome: 'failed' };
	}
	const registry = match[1] === 'docker.io' ? 'registry-1.docker.io' : 'ghcr.io';
	const image = match[2] as string;
	const url = `https://${registry}/v2/${image}/manifests/${encodeURIComponent(publication.version)}`;
	const headers: Record<string, string> = {
		Accept:
			'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
	};
	try {
		let response = await request(url, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15000),
		});
		if (response.status === 401) {
			const tokenUrl = new URL(
				registry === 'ghcr.io' ? 'https://ghcr.io/token' : 'https://auth.docker.io/token',
			);
			tokenUrl.searchParams.set(
				'service',
				registry === 'ghcr.io' ? 'ghcr.io' : 'registry.docker.io',
			);
			tokenUrl.searchParams.set('scope', `repository:${image}:pull`);
			const auth = await request(tokenUrl, {
				redirect: 'error',
				signal: AbortSignal.timeout(15000),
			});
			if (!auth.ok) return { ...publication, outcome: 'uncertain', url };
			const data = (await auth.json()) as { token?: string; access_token?: string };
			const token = data.token ?? data.access_token;
			if (typeof token !== 'string') return { ...publication, outcome: 'uncertain', url };
			headers.Authorization = `Bearer ${token}`;
			response = await request(url, {
				headers,
				redirect: 'error',
				signal: AbortSignal.timeout(15000),
			});
		}
		if (response.status === 404) return { ...publication, outcome: 'pending', url };
		if (!response.ok) return { ...publication, outcome: 'uncertain', url };
		const digest = response.headers.get('docker-content-digest');
		if (
			!digest
			|| !/^sha256:[a-f0-9]{64}$/.test(digest)
			|| !publication.digest
			|| publication.digest !== digest
		) {
			return { ...publication, outcome: 'failed', url };
		}
		// Verify the bytes as well as the registry's digest header.
		const content = await response.arrayBuffer();
		if (content.byteLength > 4 * 1024 * 1024) return { ...publication, outcome: 'failed', url };
		const hash = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
			(b) => b.toString(16).padStart(2, '0'),
		).join('');
		if (digest !== `sha256:${hash}`) return { ...publication, outcome: 'failed', url };
		if (publication.channel) {
			const channel = await verifyImage(
				{ ...publication, version: publication.channel, channel: undefined },
				request,
			);
			if (channel.outcome !== 'succeeded') return { ...publication, outcome: channel.outcome, url };
		}
		return { ...publication, outcome: 'succeeded', digest, url };
	} catch {
		return { ...publication, outcome: 'uncertain', url };
	}
}
