import { origin, type World } from '@root/test/support/world.ts';

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

export function bearer(world: World, token: string) {
	return async (path: string, body?: unknown): Promise<Reply> =>
		reply(
			await world.handle(
				new Request(`${origin}${path}`, {
					method: body === undefined ? 'GET' : 'POST',
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
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
