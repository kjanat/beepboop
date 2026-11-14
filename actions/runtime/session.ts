import type { Environment, Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, fail, required, retried } from '@root/actions/runtime/protocol.ts';
import { Effect } from 'effect';
import { bearerHeaders } from '@/contract/http.ts';
import { record } from '@/model.ts';
import { errorMessage } from '@/refusal.ts';
import { responseJson } from '@/runtime/http.ts';

export function mask(value: string): Effect.Effect<void> {
	return Effect.sync(() =>
		console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
	);
}

export function post(url: URL | string, init: RequestInit): Effect.Effect<Response, ActionFailure> {
	return Effect.tryPromise({
		try: signal =>
			fetch(url, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }),
		catch: error => new ActionFailure({ message: errorMessage(error), retryable: true }),
	});
}

export function readServiceOrigin(environment: Environment): Effect.Effect<URL, ActionFailure> {
	return Effect.gen(function*() {
		const origin = yield* Effect.fromResult(
			attempt(() => new URL(environment.SERVICE_ORIGIN || 'https://beepboop.kjanat.dev')),
		);
		if (
			origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username
			|| origin.password
		) return yield* fail('Expected an HTTPS service origin');
		return origin;
	});
}

export const serviceOrigin = Effect.suspend(() => readServiceOrigin(process.env));

export function identityToken(origin: URL, environment: Environment): Effect.Effect<string, Invalid> {
	return Effect.gen(function*() {
		const requestUrl = yield* Effect.fromResult(required(environment, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
		const requestToken = yield* Effect.fromResult(required(environment, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'));
		const endpoint = yield* Effect.fromResult(attempt(() => new URL(requestUrl)));
		endpoint.searchParams.set('audience', origin.origin);
		const identity = yield* post(endpoint, {
			headers: { Authorization: `Bearer ${requestToken}` },
			signal: AbortSignal.timeout(20000),
		});
		if (!identity.ok) return yield* fail('Could not obtain workflow identity');
		const issued = yield* responseJson(identity).pipe(
			Effect.mapError(() => new ActionFailure({ message: 'Could not obtain workflow identity' })),
		);
		const token = (yield* Effect.fromResult(record(issued))).value;
		if (typeof token !== 'string') return yield* fail('Missing workflow identity');
		yield* mask(token);
		return token;
	});
}

export function postJson(
	origin: URL,
	path: string,
	token: string,
	body: string,
): Effect.Effect<Response, ActionFailure> {
	return Effect.suspend(() => post(new URL(path, origin), {
		method: 'POST',
		headers: bearerHeaders(token),
		body,
		signal: AbortSignal.timeout(30000),
	}));
}

export function call(
	origin: URL,
	path: `/api/workflow/${string}`,
	body: unknown,
	attempts = 3,
): Effect.Effect<unknown, Invalid> {
	return retried(
		Effect.gen(function*() {
			const token = yield* identityToken(origin, process.env);
			return yield* postJson(origin, path, token, JSON.stringify(body));
		}),
		true,
		attempts,
	);
}
