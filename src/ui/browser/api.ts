import type { z } from 'zod';
import { ApiFailure, call, type Transport } from '@/contract/client';
import type { Route } from '@/contract/routes';

const send: Transport = request =>
	fetch(
		request.path,
		request.body === undefined
			? {}
			: { method: request.method, headers: { 'Content-Type': 'application/json' }, body: request.body },
	);

const browser: Transport = async request => {
	const response = await send(request);
	if (response.status !== 401 || !(await fetch('/auth/renew', { method: 'POST' })).ok) return response;
	return send(request);
};

export async function api<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	input: z.input<Q>,
): Promise<z.output<S>> {
	try {
		return await call(route, input, browser);
	} catch (error) {
		if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
		location.assign(`/auth/login?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
		throw new Error('Session expired. Signing in again.');
	}
}
