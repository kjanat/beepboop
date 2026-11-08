import { Data, Effect } from 'effect';
import type { z } from 'zod';
import { ApiFailure, call, elevatedCall, send, type Transport, type Unreachable } from '@/contract/client';
import type { Route } from '@/contract/routes';

export class SessionExpired extends Data.TaggedError('SessionExpired')<{ readonly message: string }> {}

const request: Transport = outgoing =>
	send(() =>
		fetch(
			outgoing.path,
			outgoing.body === undefined
				? {}
				: { method: outgoing.method, headers: { 'Content-Type': 'application/json' }, body: outgoing.body },
		)
	);

const browser: Transport = outgoing =>
	Effect.gen(function*() {
		const response = yield* request(outgoing);
		if (response.status !== 401) return response;
		const renewed = yield* send(() => fetch('/auth/renew', { method: 'POST' }));
		return renewed.ok ? yield* request(outgoing) : response;
	});

function expired(failure: ApiFailure): Effect.Effect<never, ApiFailure | SessionExpired> {
	return failure.status === 401
		? Effect.sync(() =>
			location.assign(`/auth/login?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
		).pipe(Effect.andThen(Effect.fail(new SessionExpired({ message: 'Session expired. Signing in again.' }))))
		: Effect.fail(failure);
}
export function api<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	input: z.input<Q>,
): Effect.Effect<z.output<S>, ApiFailure | Unreachable | SessionExpired> {
	return call(route, input, browser).pipe(Effect.catchTag('ApiFailure', expired));
}
export function elevatedApi<Q extends z.ZodType, S extends z.ZodType, E>(
	route: Route<Q, S>,
	input: (proof: string | undefined) => z.input<Q>,
	prove: Effect.Effect<string, E>,
): Effect.Effect<z.output<S>, ApiFailure | Unreachable | SessionExpired | E> {
	return elevatedCall(route, input, browser, prove).pipe(
		Effect.catchIf((error): error is ApiFailure => error instanceof ApiFailure, expired),
	);
}
