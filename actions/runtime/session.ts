import type { Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, fail, failureOf, isJson, required } from '@root/actions/runtime/protocol.ts';
import { Effect } from 'effect';
import { record } from '@/model.ts';

export function mask(value: string): Effect.Effect<void> {
	return Effect.sync(() =>
		console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
	);
}

export function post(url: URL | string, init: RequestInit): Effect.Effect<Response, ActionFailure> {
	return Effect.tryPromise({
		try: () => fetch(url, { ...init, redirect: 'error' }),
		catch: error => new ActionFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
}

export const serviceOrigin: Effect.Effect<URL, ActionFailure> = Effect.gen(function*() {
	const origin = yield* Effect.fromResult(
		attempt(() => new URL(process.env.SERVICE_ORIGIN || 'https://beepboop.kjanat.dev')),
	);
	if (
		origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username
		|| origin.password
	) return yield* fail('Expected an HTTPS service origin');
	return origin;
});

export function identityToken(origin: URL): Effect.Effect<string, Invalid> {
	return Effect.gen(function*() {
		const requestUrl = yield* Effect.fromResult(required(process.env, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
		const requestToken = yield* Effect.fromResult(required(process.env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'));
		const endpoint = yield* Effect.fromResult(attempt(() => new URL(requestUrl)));
		endpoint.searchParams.set('audience', origin.origin);
		const identity = yield* post(endpoint, {
			headers: { Authorization: `Bearer ${requestToken}` },
			signal: AbortSignal.timeout(20000),
		});
		if (!identity.ok) return yield* fail('Could not obtain workflow identity');
		const issued = yield* Effect.tryPromise({
			try: (): Promise<unknown> => identity.json(),
			catch: () => new ActionFailure({ message: 'Could not obtain workflow identity' }),
		});
		const token = (yield* Effect.fromResult(record(issued))).value;
		if (typeof token !== 'string') return yield* fail('Missing workflow identity');
		yield* mask(token);
		return token;
	});
}

export function call(
	origin: URL,
	path: `/api/workflow/${string}`,
	body: unknown,
	attempts = 3,
): Effect.Effect<unknown, Invalid> {
	const once = (count: number): Effect.Effect<unknown, Invalid> =>
		Effect.gen(function*() {
			const token = yield* identityToken(origin);
			const response = yield* post(new URL(path, origin), {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(30000),
			});
			if (response.ok) {
				if (!isJson(response)) return yield* fail(`Beepboop answered HTTP ${response.status} without JSON`);
				return yield* Effect.tryPromise({
					try: (): Promise<unknown> => response.json(),
					catch: () => new ActionFailure({ message: `Beepboop answered HTTP ${response.status} with invalid JSON` }),
				});
			}
			const failure = yield* failureOf(response);
			if (!failure.retryable || count >= attempts) return yield* fail(failure.message);
			yield* Effect.sleep(1000 * 2 ** (count - 1));
			return yield* once(count + 1);
		});
	return once(1);
}
