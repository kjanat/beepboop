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
