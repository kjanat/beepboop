import type { Repository } from '@root/test/support/github.ts';
import { bearerRequest } from '@root/test/support/http.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { Effect, Schema, Struct } from 'effect';
import type { Transport } from '@/contract/client';
import { call as request, send } from '@/contract/client';
import type { Route } from '@/contract/routes';
import { routes } from '@/contract/routes';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';

export function cliTransport(world: World, token: string): Transport {
	return outgoing => send(() => bearerRequest(world, token, outgoing));
}

export function call<Q extends Contract, S extends Contract>(
	route: Route<Q, S>,
	input: Encoded<Q>,
	transport: Transport,
): Promise<Decoded<S>> {
	return Effect.runPromise(request(route, input, transport));
}

export async function discoveredWidget(world: World, token: string): Promise<Repository> {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	await call(routes.repositoriesDiscover, { repository: repository.name }, cliTransport(world, token));
	return repository;
}
