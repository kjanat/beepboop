import { Effect, Result } from 'effect';
import type { Fetcher, RegistryVersion } from '@/automation/managers/registry';
import type { Publication } from '@/automation/types';
import { fromPromise } from '@/failure';
import { semver } from '@/model';

/** Transport handling is shared; registry response semantics belong to each adapter. */
export function verifyRegistry(
	publication: Publication,
	request: Fetcher,
	url: string,
	decode: (body: unknown) => { matches: boolean; digest: unknown },
	channel?: string,
): Effect.Effect<Publication> {
	return Effect.gen(function*() {
		const response = yield* fromPromise(() =>
			request(url, {
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
				headers: { 'User-Agent': 'beepboop release verification' },
			})
		);
		if (response.status === 404) return { ...publication, outcome: 'pending' as const, url };
		if (!response.ok) return { ...publication, outcome: 'uncertain' as const, url };
		const body: unknown = yield* fromPromise(() => response.json());
		const { matches, digest } = decode(body);
		if (!matches || typeof digest !== 'string' || !digest || (publication.digest && publication.digest !== digest)) {
			return { ...publication, outcome: 'failed' as const, url };
		}
		if (channel) {
			const tagged = yield* fromPromise(() =>
				request(channel, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
			);
			if (!tagged.ok) return { ...publication, outcome: 'pending' as const, url };
			const tags: unknown = yield* fromPromise(() => tagged.json());
			if (!tags || typeof tags !== 'object' || Reflect.get(tags, publication.channel ?? '') !== publication.version) {
				return { ...publication, outcome: 'pending' as const, url };
			}
		}
		return { ...publication, outcome: 'succeeded' as const, digest, url };
	}).pipe(Effect.catchCause(() => Effect.succeed({ ...publication, outcome: 'uncertain' as const, url })));
}
export const unpublished: unique symbol = Symbol('unpublished');
export interface RegistryQuery {
	method: 'POST';
	headers: Record<string, string>;
	body: string;
}
export class LookupFailure {
	constructor(readonly reason: string) {}
}
export function latestVersion(
	request: Fetcher,
	url: string,
	decode: (body: unknown) => unknown,
	query?: RegistryQuery,
): Effect.Effect<RegistryVersion> {
	return lookup(
		request,
		url,
		response => fromPromise((): Promise<unknown> => response.json()).pipe(Effect.map(decode)),
		query,
	);
}
export function latestText(
	request: Fetcher,
	url: string,
	decode: (body: string) => unknown,
): Effect.Effect<RegistryVersion> {
	return lookup(request, url, response => fromPromise(() => response.text()).pipe(Effect.map(decode)));
}
function lookup(
	request: Fetcher,
	url: string,
	read: (response: Response) => Effect.Effect<unknown, unknown>,
	query?: RegistryQuery,
): Effect.Effect<RegistryVersion> {
	return Effect.gen(function*() {
		const response = yield* fromPromise(() =>
			request(url, {
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
				...(query ? { method: query.method, body: query.body } : {}),
				headers: { 'User-Agent': 'beepboop release verification', ...query?.headers },
			})
		);
		if (response.status === 404) return { kind: 'missing', url } satisfies RegistryVersion;
		if (!response.ok) return { kind: 'failed', url, reason: `HTTP ${response.status}` } satisfies RegistryVersion;
		const version = yield* read(response);
		if (version === unpublished) return { kind: 'missing', url } satisfies RegistryVersion;
		if (version instanceof LookupFailure) {
			return { kind: 'failed', url, reason: version.reason } satisfies RegistryVersion;
		}
		return Result.match(semver(version), {
			onSuccess: (value): RegistryVersion => ({ kind: 'published', version: value.replace(/^v/, '') }),
			onFailure: (): RegistryVersion => ({ kind: 'failed', url, reason: 'no valid version' }),
		});
	}).pipe(Effect.catchCause(() => Effect.succeed<RegistryVersion>({ kind: 'failed', url, reason: 'request failed' })));
}
