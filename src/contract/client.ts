import { Data, Effect } from 'effect';
import type { ApiError } from '@/contract/errors';
import { errorEnvelope, securityKeyRequired } from '@/contract/errors';
import { isJson } from '@/contract/http';
import type { Route } from '@/contract/routes';
import { awaitWith } from '@/refusal';
import { responseJson } from '@/runtime/http';
import type { Contract, Decoded, Encoded } from '@/schema';
import { safeDecode } from '@/schema';

export interface Outgoing {
	method: 'GET' | 'POST';
	path: string;
	body: string | undefined;
}

export class ApiFailure extends Data.TaggedError('ApiFailure')<{
	readonly status: number;
	readonly problem: ApiError | undefined;
	readonly message: string;
}> {}

export class Unreachable extends Data.TaggedError('Unreachable')<{
	readonly message: string;
	readonly cause: unknown;
}> {}

export type Transport = (request: Outgoing) => Effect.Effect<Response, Unreachable>;

const reach = awaitWith((message, cause) => new Unreachable({ message, cause }));

export function send(run: (signal: AbortSignal) => Promise<Response>): Effect.Effect<Response, Unreachable> {
	return reach(run);
}

export function failureOf(response: Response): Effect.Effect<ApiFailure> {
	const fallback = new ApiFailure({
		status: response.status,
		problem: undefined,
		message: `Beepboop request failed (${response.status})`,
	});
	if (!isJson(response)) return Effect.succeed(fallback);
	return responseJson(response).pipe(
		Effect.orElseSucceed(() => undefined),
		Effect.map(body => {
			const parsed = safeDecode(errorEnvelope, body);
			return parsed.success
				? new ApiFailure({ status: response.status, problem: parsed.data.problem, message: parsed.data.error })
				: fallback;
		}),
	);
}

function query(input: unknown): string {
	if (typeof input !== 'object' || input === null) return '';
	const parameters = new URLSearchParams();
	for (const [name, value] of Object.entries(input)) {
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			parameters.set(name, String(value));
		}
	}
	const encoded = parameters.toString();
	return encoded ? `?${encoded}` : '';
}

export function outgoing<Q extends Contract, S extends Contract>(route: Route<Q, S>, input: Encoded<Q>): Outgoing {
	if (route.method === 'GET') return { method: route.method, path: `${route.path}${query(input)}`, body: undefined };
	return { method: route.method, path: route.path, body: JSON.stringify(input) };
}

export function call<Q extends Contract, S extends Contract>(
	route: Route<Q, S>,
	input: Encoded<Q>,
	transport: Transport,
): Effect.Effect<Decoded<S>, ApiFailure | Unreachable> {
	return Effect.gen(function*() {
		const response = yield* transport(outgoing(route, input));
		if (!response.ok) return yield* yield* failureOf(response);
		if (!isJson(response)) {
			return yield* new ApiFailure({
				status: response.status,
				problem: undefined,
				message: 'Beepboop answered without JSON',
			});
		}
		const invalid = () =>
			new ApiFailure({
				status: response.status,
				problem: undefined,
				message: 'Beepboop answered with invalid JSON or an invalid response',
			});
		const body = yield* responseJson(response).pipe(Effect.mapError(invalid));
		const parsed = safeDecode(route.response, body);
		return parsed.success ? parsed.data : yield* invalid();
	});
}
export function elevatedCall<Q extends Contract, S extends Contract, E>(
	route: Route<Q, S>,
	input: (proof: string | undefined) => Encoded<Q>,
	transport: Transport,
	prove: Effect.Effect<string, E>,
): Effect.Effect<Decoded<S>, ApiFailure | Unreachable | E> {
	return call(route, input(undefined), transport).pipe(
		Effect.catchIf(
			(error): error is ApiFailure =>
				error._tag === 'ApiFailure' && error.status === 403 && error.message === securityKeyRequired,
			() => Effect.flatMap(prove, proof => call(route, input(proof), transport)),
		),
	);
}
