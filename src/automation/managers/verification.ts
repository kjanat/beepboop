import { semver } from '#model';
import type { Publication } from '../types.ts';
import type { Fetcher, RegistryVersion } from './registry.ts';

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
			redirect: 'manual',
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
			const response = await request(channel, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
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
export async function latestVersion(
	request: Fetcher,
	url: string,
	decode: (body: unknown) => unknown,
): Promise<RegistryVersion> {
	try {
		const response = await request(url, {
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000),
			headers: { 'User-Agent': 'beepboop release verification' },
		});
		if (response.status === 404) return { kind: 'missing', url };
		if (!response.ok) return { kind: 'failed', url, reason: `HTTP ${response.status}` };
		const version = decode(await response.json());
		try {
			return { kind: 'published', version: semver(version).replace(/^v/, '') };
		} catch {
			return { kind: 'failed', url, reason: 'no valid version' };
		}
	} catch {
		return { kind: 'failed', url, reason: 'request failed' };
	}
}
