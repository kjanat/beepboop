import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, Runner } from '@root/actions/runtime/publish.ts';
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

export function cargoMetadata(target: string): Command {
	const metadata = JSON.stringify({ target_directory: target });
	return { code: 0, stdout: metadata, output: metadata };
}

export function crateBytes(name: string, version: string): string {
	return `${name} ${version}\n`;
}

export function crateArchive(target: string, name: string, version: string): string {
	return join(target, 'package', `${name}-${version}.crate`);
}

export function packCrate(target: string, name: string, version: string): void {
	mkdirSync(join(target, 'package'), { recursive: true });
	writeFileSync(crateArchive(target, name, version), crateBytes(name, version));
}

export function crateChecksum(target: string, name: string, version: string): string {
	return createHash('sha256').update(readFileSync(crateArchive(target, name, version))).digest('hex');
}
