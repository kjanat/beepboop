import { Effect } from 'effect';
import type { Jwks, JwsKeyResolver } from 'micro509/jose';
import { createJwksKeyResolver, DEFAULT_JWKS_LIMITS, parseJwks } from 'micro509/jose';
import { failureResult } from 'micro509/result';
import type { Fetcher } from '@/automation/managers/registry';
import { scopedResponse } from '@/runtime/http';

interface Snapshot {
	readonly keys: Jwks;
	readonly fetchedAt: number;
}

// Share completed snapshots only: each request owns its fetch, cancellation and key imports.
// Keep the previous ten-minute lifetime and thirty-second successful-refresh cooldown.
const caches = new WeakMap<Fetcher, Map<string, Snapshot>>();
const lifetime = 600_000;
const cooldown = 30_000;
const unavailable = () => failureResult('jwks_unavailable', 'Could not retrieve signing keys');
const malformed = () => failureResult('jwks_malformed', 'Invalid signing key set');

function boundedBody(response: Response) {
	return Effect.acquireUseRelease(
		Effect.sync(() => response.body?.getReader()),
		reader => Effect.gen(function*() {
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (reader) {
				for (;;) {
					const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: unavailable });
					if (chunk.done) break;
					size += chunk.value.byteLength;
					if (size > DEFAULT_JWKS_LIMITS.maxBytes) return yield* Effect.fail(malformed());
					chunks.push(chunk.value);
				}
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return bytes;
		}),
		reader =>
			reader
				? Effect.promise(async () => {
					let timer: ReturnType<typeof setTimeout> | undefined;
					try {
						await Promise.race([
							reader.cancel().catch(() => {}),
							new Promise<void>(resolve => {
								timer = setTimeout(resolve, 1000);
							}),
						]);
					} finally {
						clearTimeout(timer);
						reader.releaseLock();
					}
				})
				: Effect.void,
	);
}

function fetchKeys(url: URL, transport: Fetcher) {
	return Effect.scoped(Effect.gen(function*() {
		const response = yield* scopedResponse(Effect.tryPromise({
			try: signal =>
				transport(url, {
					headers: { accept: 'application/json' },
					redirect: 'manual',
					credentials: 'omit',
					signal,
				}).then(response => {
					// A transport may ignore cancellation and deliver its response after the scope closes.
					if (signal.aborted) void response.body?.cancel().catch(() => {});
					return response;
				}),
			catch: unavailable,
		}));
		if (response.status !== 200) {
			return yield* Effect.fail(failureResult('jwks_unavailable', 'Signing key endpoint refused the request', {
				status: response.status,
			}));
		}
		const parsed = parseJwks(yield* boundedBody(response));
		if (!parsed.ok) return yield* Effect.fail(malformed());
		return parsed.value;
	}));
}

export function remoteKeys(url: URL, transport: Fetcher): JwsKeyResolver {
	let cache = caches.get(transport);
	if (!cache) {
		cache = new Map();
		caches.set(transport, cache);
	}
	const snapshots = cache;
	const endpoint = new URL(url);
	return async request => {
		if (request.signal?.aborted) return failureResult('aborted', 'Signing key resolution was cancelled');
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(), 5000);
		const signal = request.signal ? AbortSignal.any([request.signal, deadline.signal]) : deadline.signal;
		const resolve = (keys: Jwks) => Effect.tryPromise({
			try: signal => createJwksKeyResolver(keys)({ ...request, signal }),
			catch: () => failureResult('key_resolution_failed', 'Signing key resolution failed unexpectedly'),
		});
		try {
			const result = await Effect.runPromise(
				Effect.gen(function*() {
					const snapshot = snapshots.get(endpoint.href);
					const age = snapshot ? Date.now() - snapshot.fetchedAt : Infinity;
					if (snapshot && age < lifetime) {
						const cached = yield* resolve(snapshot.keys);
						if (cached.ok || (cached.code !== 'key_not_found' && cached.code !== 'key_unsuitable') || age < cooldown) {
							return cached;
						}
					}
					const keys = yield* fetchKeys(endpoint, transport);
					// Keep any snapshot published by a peer while this fetch was outstanding.
					if (snapshots.get(endpoint.href) === snapshot) {
						snapshots.set(endpoint.href, { keys, fetchedAt: Date.now() });
					}
					return yield* resolve(keys);
				}).pipe(
					Effect.match({
						onFailure: error => error,
						onSuccess: result => result,
					}),
				),
				{ signal },
			);
			if (signal.aborted) {
				return request.signal?.aborted
					? failureResult('aborted', 'Signing key resolution was cancelled')
					: unavailable();
			}
			return result;
		} catch {
			if (request.signal?.aborted) return failureResult('aborted', 'Signing key resolution was cancelled');
			return deadline.signal.aborted
				? unavailable()
				: failureResult('key_resolution_failed', 'Signing key resolution failed unexpectedly');
		} finally {
			clearTimeout(timer);
		}
	};
}
