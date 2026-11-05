import { Effect } from 'effect';
import type { z } from 'zod';
import { call as request, send, type Transport } from '@/contract/client';
import type { Route } from '@/contract/routes';
import { origin, type World } from '@root/test/support/world.ts';

export function cliTransport(world: World, token: string): Transport {
	return outgoing =>
		send(() =>
			world.handle(
				new Request(`${origin}${outgoing.path}`, {
					method: outgoing.method,
					headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
					...(outgoing.body === undefined ? {} : { body: outgoing.body }),
				}),
			)
		);
}

export function call<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	input: z.input<Q>,
	transport: Transport,
): Promise<z.output<S>> {
	return Effect.runPromise(request(route, input, transport));
}
