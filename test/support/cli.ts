import { spyOn } from 'bun:test';
import type { World } from '@root/test/support/world.ts';
import { origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { app } from '@/cli/cli';
import { Client } from '@/cli/client';

export async function savedClient(world: World, directory: string): Promise<{ client: Client; token: string }> {
	const client = await Effect.runPromise(Client.at(origin, directory));
	const token = await world.cliSession();
	await Effect.runPromise(client.save({ token }));
	spyOn(Client, 'at').mockReturnValue(Effect.succeed(client));
	return { client, token };
}

export function runCli(args: string[], answers?: unknown[]) {
	return app.execute(args, { answers, isTTY: true, env: {} });
}
