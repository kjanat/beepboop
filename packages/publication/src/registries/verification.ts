import type { Scope } from 'effect';
import { Effect, Result } from 'effect';
import { semver } from '@/domain/semver.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { ResponseReadError, responseJson, responseText, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import type { Outcome, Publication } from '@/publication/publication.ts';
import type { LookupOutcome } from '@/publication/registries/outcome.ts';
import { CheckOutcome, VerificationOutcome } from '@/publication/registries/outcome.ts';

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
): Effect.Effect<Response, DomainError, Scope.Scope> {
	return scopedResponse(fromPromise(signal =>
		request(url, {
			redirect: 'manual',
			signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
			...(init.method ? { method: init.method } : {}),
			...(init.body === undefined ? {} : { body: init.body }),
			headers: { 'User-Agent': 'beepboop release verification', ...init.headers },
		})
	));
}
export function unconfirmed(response: Response, url: string): CheckOutcome | undefined {
	if (response.status === 404) return VerificationOutcome.Pending({ url });
	if (!response.ok) return VerificationOutcome.LookupFailed({ url, reason: `HTTP ${response.status}` });
	return undefined;
}
export interface CheckOutcomes {
	published(digest?: string): CheckOutcome;
	pending(): CheckOutcome;
	rejected(): CheckOutcome;
	failed(reason: string): CheckOutcome;
}
export function checkOutcomes(publication: Publication, url: string): CheckOutcomes {
	return {
		published: digest =>
			VerificationOutcome.Published({
				version: publication.version,
				url,
				...(digest === undefined ? {} : { digest }),
			}),
		pending: () => VerificationOutcome.Pending({ url }),
		rejected: () => VerificationOutcome.Rejected({ url }),
		failed: reason => VerificationOutcome.LookupFailed({ url, reason }),
	};
}
export function verifiedPublication(publication: Publication, outcome: CheckOutcome): Publication {
	const settled = (state: Outcome, url?: string, digest?: string): Publication => ({
		...publication,
		outcome: state,
		...(url === undefined ? {} : { url }),
		...(digest === undefined ? {} : { digest }),
	});
	return CheckOutcome.$match(outcome, {
		Published: ({ url, digest }) => settled('succeeded', url, digest),
		Pending: ({ url }) => settled('pending', url),
		Rejected: ({ url }) => settled('failed', url),
		LookupFailed: ({ url }) => settled('uncertain', url),
		Unverifiable: () => settled('uncertain'),
	});
}
export const verificationFailure = 'verification request failed';
/** Transport handling is shared; registry response semantics belong to each adapter. */
export function verifyRegistry(
	publication: Publication,
	request: Fetcher,
	url: string,
	decode: (body: unknown) => RegistryEntry,
	channel?: string,
): Effect.Effect<CheckOutcome> {
	const result = checkOutcomes(publication, url);
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url);
		const missing = unconfirmed(response, url);
		if (missing) return missing;
		const body: unknown = yield* responseJson(response);
		const entry = decode(body);
		const digest = entry.digest;
		if (
			entry.name !== publication.name || entry.version !== publication.version || entry.withdrawn === true
			|| typeof digest !== 'string' || !digest || (publication.digest && publication.digest !== digest)
		) {
			return result.rejected();
		}
		if (channel) {
			const tagged = yield* registryRequest(request, channel);
			if (!tagged.ok) return result.pending();
			const tags: unknown = yield* responseJson(tagged);
			if (!tags || typeof tags !== 'object' || Reflect.get(tags, publication.channel ?? '') !== publication.version) {
				return result.pending();
			}
		}
		return result.published(digest);
	}).pipe(Effect.scoped, Effect.orElseSucceed(() => result.failed(verificationFailure)));
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
): Effect.Effect<LookupOutcome> {
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
): Effect.Effect<LookupOutcome> {
	return lookup(request, url, response => responseText(response).pipe(Effect.map(decode)));
}
function lookup(
	request: Fetcher,
	url: string,
	read: (response: Response) => Effect.Effect<unknown, unknown>,
	query?: RegistryRequest,
): Effect.Effect<LookupOutcome> {
	return Effect.gen(function*() {
		const response = yield* registryRequest(request, url, query).pipe(
			Effect.mapError(error =>
				error.cause instanceof Error && error.cause.name === 'TimeoutError'
					? 'request timed out'
					: 'network request failed'
			),
		);
		if (response.status === 404) return VerificationOutcome.Missing({ url });
		if (!response.ok) return VerificationOutcome.LookupFailed({ url, reason: `HTTP ${response.status}` });
		const version = yield* read(response).pipe(Effect.mapError(error => {
			const cause = error instanceof ResponseReadError ? error.cause : error;
			if (cause instanceof Error && cause.name === 'TimeoutError') return 'request timed out';
			return cause instanceof SyntaxError ? 'invalid registry response' : 'registry response could not be read';
		}));
		if (version === unpublished) return VerificationOutcome.Missing({ url });
		if (version instanceof LookupFailure) {
			return VerificationOutcome.LookupFailed({ url, reason: version.reason });
		}
		return Result.match(semver(version), {
			onSuccess: (value): LookupOutcome => VerificationOutcome.Published({ version: value.replace(/^v/, '') }),
			onFailure: (): LookupOutcome => VerificationOutcome.LookupFailed({ url, reason: 'no valid version' }),
		});
	}).pipe(
		Effect.scoped,
		Effect.orElseSucceed((reason): LookupOutcome => VerificationOutcome.LookupFailed({ url, reason })),
	);
}
