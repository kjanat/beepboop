import { Data, Effect } from 'effect';
import type { z } from 'zod';
import { type ApiError, errorEnvelope } from '@/contract/errors';
import type { Route } from '@/contract/routes';

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

export function send(run: () => Promise<Response>): Effect.Effect<Response, Unreachable> {
	return Effect.tryPromise({
		try: run,
		catch: cause => new Unreachable({ message: cause instanceof Error ? cause.message : String(cause), cause }),
	});
}

function json(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').split(';')[0]?.trim() === 'application/json';
}

export function failureOf(response: Response): Effect.Effect<ApiFailure> {
	const fallback = new ApiFailure({
		status: response.status,
		problem: undefined,
		message: `Beepboop request failed (${response.status})`,
	});
	if (!json(response)) return Effect.succeed(fallback);
	return Effect.promise((): Promise<unknown> => response.json().catch(() => undefined)).pipe(
		Effect.map(body => {
			const parsed = errorEnvelope.safeParse(body);
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

export function outgoing<Q extends z.ZodType, S extends z.ZodType>(route: Route<Q, S>, input: z.input<Q>): Outgoing {
	if (route.method === 'GET') return { method: route.method, path: `${route.path}${query(input)}`, body: undefined };
	return { method: route.method, path: route.path, body: JSON.stringify(input) };
}

export function call<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	input: z.input<Q>,
	transport: Transport,
): Effect.Effect<z.output<S>, ApiFailure | Unreachable> {
	return Effect.gen(function*() {
		const response = yield* transport(outgoing(route, input));
		if (!response.ok) return yield* yield* failureOf(response);
		if (!json(response)) {
			return yield* new ApiFailure({
				status: response.status,
				problem: undefined,
				message: 'Beepboop answered without JSON',
			});
		}
		const body = yield* Effect.promise((): Promise<unknown> => response.json());
		return route.response.parse(body);
	});
}
