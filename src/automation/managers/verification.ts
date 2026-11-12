import { Effect, Result } from 'effect';
import type { Fetcher, RegistryVersion } from '@/automation/managers/registry';
import type { Outcome, Publication } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { fromPromise } from '@/failure';
import { semver } from '@/model';
import { responseJson, responseText } from '@/runtime/http';

export interface RegistryRequest {
	method?: 'POST';
	headers?: Record<string, string>;
	body?: string;
}
export interface RegistryEntry {
	name: unknown;
	version: unknown;
	digest: unknown;
	withdrawn?: boolean;
}
export function registryRequest(
	request: Fetcher,
	url: string,
	init: RegistryRequest = {},
): Effect.Effect<Response, DomainError> {
	return fromPromise(signal =>
		request(url, {
			redirect: 'manual',
			signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
			...(init.method ? { method: init.method } : {}),
			...(init.body === undefined ? {} : { body: init.body }),
			headers: { 'User-Agent': 'beepboop release verification', ...init.headers },
		})
	);
}
export function unconfirmed(response: Response): Outcome | undefined {
	if (response.status === 404) return 'pending';
	if (!response.ok) return 'uncertain';
	return undefined;
}
export function publicationResult(
	publication: Publication,
	url: string,
): (outcome: Outcome, digest?: string) => Publication {
	return (outcome, digest) => ({
		...publication,
		outcome,
		url,
		...(digest === undefined ? {} : { digest }),
	});
}
/** Transport handling is shared; registry response semantics belong to each adapter. */
export function verifyRegistry(
	publication: Publication,
	request: Fetcher,
	url: string,
	decode: (body: unknown) => RegistryEntry,
	channel?: string,
): Effect.Effect<Publication> {
	const result = publicationResult(publication, url);
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url);
		const missing = unconfirmed(response);
		if (missing) return result(missing);
		const body: unknown = yield* responseJson(response);
		const entry = decode(body);
		const digest = entry.digest;
		if (
			entry.name !== publication.name || entry.version !== publication.version || entry.withdrawn === true
			|| typeof digest !== 'string' || !digest || (publication.digest && publication.digest !== digest)
		) {
			return result('failed');
		}
		if (channel) {
			const tagged = yield* fromPromise(signal =>
				request(channel, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
			);
			if (!tagged.ok) return result('pending');
			const tags: unknown = yield* fromPromise(() => tagged.json());
			if (!tags || typeof tags !== 'object' || Reflect.get(tags, publication.channel ?? '') !== publication.version) {
				return result('pending');
			}
		}
		return result('succeeded', digest);
	}).pipe(Effect.orElseSucceed(() => result('uncertain')));
}
export const unpublished: unique symbol = Symbol('unpublished');
export class LookupFailure {
	constructor(readonly reason: string) {}
}
export function latestVersion(
	request: Fetcher,
	url: string,
	decode: (body: unknown) => unknown,
	query?: RegistryRequest,
): Effect.Effect<RegistryVersion> {
	return lookup(
		request,
		url,
		response => responseJson(response).pipe(Effect.map(decode)),
		query,
	);
}
export function latestText(
	request: Fetcher,
	url: string,
	decode: (body: string) => unknown,
): Effect.Effect<RegistryVersion> {
	return lookup(request, url, response => responseText(response).pipe(Effect.map(decode)));
}
function lookup(
	request: Fetcher,
	url: string,
	read: (response: Response) => Effect.Effect<unknown, unknown>,
	query?: RegistryRequest,
): Effect.Effect<RegistryVersion> {
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url, query);
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
	}).pipe(Effect.orElseSucceed((): RegistryVersion => ({ kind: 'failed', url, reason: 'request failed' })));
}
