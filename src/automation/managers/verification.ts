import type { Publication } from '../types.ts';
import type { Fetcher } from './registry.ts';

/** Transport handling is shared; registry response semantics belong to each adapter. */
export async function verifyRegistry(
	publication: Publication,
	request: Fetcher,
	url: string,
	decode: (body: unknown) => { matches: boolean; digest: unknown },
	channel?: string,
): Promise<Publication> {
	try {
		const response = await request(url, {
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
			headers: { 'User-Agent': 'beepboop release verification' },
		});
		if (response.status === 404) return { ...publication, outcome: 'pending', url };
		if (!response.ok) return { ...publication, outcome: 'uncertain', url };
		const { matches, digest } = decode(await response.json());
		if (!matches || typeof digest !== 'string' || !digest || (publication.digest && publication.digest !== digest)) {
			return { ...publication, outcome: 'failed', url };
		}
		if (channel) {
			const response = await request(channel, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
			if (!response.ok) return { ...publication, outcome: 'pending', url };
			const tags: unknown = await response.json();
			if (!tags || typeof tags !== 'object' || Reflect.get(tags, publication.channel ?? '') !== publication.version) {
				return { ...publication, outcome: 'pending', url };
			}
		}
		return { ...publication, outcome: 'succeeded', digest, url };
	} catch {
		return { ...publication, outcome: 'uncertain', url };
	}
}
