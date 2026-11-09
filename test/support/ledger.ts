import { Effect } from 'effect';
import { publishPackages, type Runner } from '@root/actions/runtime/publish.ts';
import { call } from '@root/actions/runtime/session.ts';
import type { RunIdentity, World } from '@root/test/support/world.ts';

export const tokenHost = 'pipelines.actions.githubusercontent.com';

export interface Publishing {
	run: Runner['run'];
	scratch: string;
	credentials?: Record<string, string>;
	provenance?: boolean;
}

export async function withIdentity<A>(
	world: World,
	identity: RunIdentity,
	work: () => Promise<A>,
	variables: Record<string, string> = {},
): Promise<A> {
	world.network.serve(tokenHost, async () => Response.json({ value: await world.runToken(identity) }));
	const saved = { ...process.env };
	Object.assign(process.env, {
		ACTIONS_ID_TOKEN_REQUEST_URL: `https://${tokenHost}/token?api-version=2.0`,
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
		...variables,
	});
	const log = console.log;
	console.log = () => undefined;
	try {
		return await work();
	} finally {
		console.log = log;
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
	}
}

export function workflowCall(world: World, path: `/api/workflow/${string}`, body: unknown) {
	return call(new URL(world.env.APPLICATION_ORIGIN), path, body);
}

export async function publishWith(world: World, identity: RunIdentity, executionId: string, options: Publishing) {
	const logs: string[] = [];
	const runner: Runner = {
		executionId,
		credentials: options.credentials ?? {},
		provenance: options.provenance === true,
		call: (path, body) => workflowCall(world, path, body),
		run: options.run,
		sleep: milliseconds => Effect.sync(() => world.advance(milliseconds)),
		now: () => Date.now(),
		log: line => logs.push(line),
	};
	const result = await withIdentity(
		world,
		identity,
		() => Effect.runPromise(Effect.result(publishPackages(runner))),
		{ RUNNER_TEMP: options.scratch },
	);
	return { result, logs };
}
