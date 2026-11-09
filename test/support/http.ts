import type { World } from '@root/test/support/world.ts';
import { origin } from '@root/test/support/world.ts';
import type { Outgoing } from '@/contract/client';
import { bearerHeaders } from '@/contract/http';

export interface Reply {
	status: number;
	body: unknown;
	bytes: number;
	headers: Headers;
}

export async function reply(response: Response): Promise<Reply> {
	const text = await response.text();
	let body: unknown = text;
	if (response.headers.get('content-type')?.includes('json')) body = JSON.parse(text);
	return { status: response.status, body, bytes: new TextEncoder().encode(text).byteLength, headers: response.headers };
}

export function bearerRequest(world: World, token: string, outgoing: Outgoing): Promise<Response> {
	return world.handle(
		new Request(`${origin}${outgoing.path}`, {
			method: outgoing.method,
			headers: bearerHeaders(token),
			...(outgoing.body === undefined ? {} : { body: outgoing.body }),
		}),
	);
}

export function bearer(world: World, token: string) {
	return async (path: string, body?: unknown): Promise<Reply> =>
		reply(
			await bearerRequest(
				world,
				token,
				body === undefined
					? { method: 'GET', path, body: undefined }
					: { method: 'POST', path, body: JSON.stringify(body) },
			),
		);
}

export function field(value: unknown, name: string): unknown {
	if (typeof value !== 'object' || value === null) throw new Error(`Expected an object with ${name}`);
	return Reflect.get(value, name);
}

export function text(value: unknown, name: string): string {
	const result = field(value, name);
	if (typeof result !== 'string') throw new Error(`Expected ${name} to be a string, got ${JSON.stringify(result)}`);
	return result;
}
