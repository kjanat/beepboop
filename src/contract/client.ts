import type { z } from 'zod';
import { type ApiError, errorEnvelope } from '@/contract/errors';
import type { Route } from '@/contract/routes';

export interface Outgoing {
	method: 'GET' | 'POST';
	path: string;
	body: string | undefined;
}
export type Transport = (request: Outgoing) => Promise<Response>;

export class ApiFailure extends Error {
	constructor(readonly status: number, readonly problem: ApiError | undefined, message: string) {
		super(message);
		this.name = 'ApiFailure';
	}
}

function json(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').split(';')[0]?.trim() === 'application/json';
}

export async function failureOf(response: Response): Promise<ApiFailure> {
	const fallback = `Beepboop request failed (${response.status})`;
	if (!json(response)) return new ApiFailure(response.status, undefined, fallback);
	const parsed = errorEnvelope.safeParse(await response.json().catch(() => undefined));
	return parsed.success
		? new ApiFailure(response.status, parsed.data.problem, parsed.data.error)
		: new ApiFailure(response.status, undefined, fallback);
}

export function outgoing<Q extends z.ZodType, S extends z.ZodType>(route: Route<Q, S>, input: z.input<Q>): Outgoing {
	return {
		method: route.method,
		path: route.path,
		body: route.method === 'GET' ? undefined : JSON.stringify(input),
	};
}

export async function call<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	input: z.input<Q>,
	transport: Transport,
): Promise<z.output<S>> {
	const response = await transport(outgoing(route, input));
	if (!response.ok) throw await failureOf(response);
	if (!json(response)) throw new ApiFailure(response.status, undefined, 'Beepboop answered without JSON');
	return route.response.parse(await response.json());
}
