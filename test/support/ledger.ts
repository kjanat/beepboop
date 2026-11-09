import type { Runner } from '@root/actions/runtime/publish.ts';
import { publishPackages } from '@root/actions/runtime/publish.ts';
import { call } from '@root/actions/runtime/session.ts';
import { tokenHost, tokenRequest } from '@root/test/support/actions.ts';
import { withConsoleLog, withEnvironment } from '@root/test/support/process.ts';
import type { RunIdentity, World } from '@root/test/support/world.ts';
import { Effect } from 'effect';

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
	return withEnvironment({ ...tokenRequest, ...variables }, () => withConsoleLog(() => undefined, work));
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
		exists: () => false,
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
