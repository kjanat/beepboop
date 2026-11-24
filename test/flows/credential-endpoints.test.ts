import { expect, test } from 'bun:test';
import { discoveredWidget } from '@root/test/support/client.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer } from '@root/test/support/http.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Cause, Effect, Exit } from 'effect';
import { deliverCredentials } from '@/credentials/http/credentials.ts';
import { DomainError, errorEnvelope } from '@/kernel/errors/domain-error.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

function refusal(response: Reply): [number, string] {
	return [response.status, decodeSync(errorEnvelope, response.body).error];
}

test('credential endpoints refuse unknown names and grants and serve a stored value', async () => {
	const repository = await discoveredWidget(world, await world.cliSession());
	const api = bearer(world, await world.cliSession());
	const elevated = async (path: string, body: Record<string, unknown>) => {
		await world.db.prepare('DELETE FROM sessions WHERE id=?').bind('proof').run();
		await world.elevate();
		return api(path, { ...body, proof: 'proof' });
	};
	const selection = {
		alias: 'npm-token',
		repositoryId: repository.id,
		stream: 'main',
		operation: 'promote',
		delivery: 'runtime',
	};
	const missing: [number, string] = [404, 'No stored value under this name'];

	expect(refusal(await elevated('/api/credentials/reveal', { alias: 'npm-token' }))).toEqual(missing);
	expect(refusal(await elevated('/api/credentials/sync', { alias: 'npm-token' }))).toEqual(missing);
	expect(refusal(await elevated('/api/credentials/grant', { selection }))).toEqual([
		422,
		'Store a value under this name before granting access',
	]);
	expect(refusal(await elevated('/api/credentials/revoke', { grantId: 'missing' }))).toEqual([404, 'Unknown grant']);
	expect(refusal(await elevated('/api/credentials/grant', { selection: { ...selection, repositoryId: 999 } })))
		.toEqual([404, 'Repository is not enrolled']);
	expect(await world.db.prepare('SELECT id FROM sessions WHERE id=?').bind('proof').first()).toEqual({ id: 'proof' });

	expect((await elevated('/api/credentials/replace', { alias: 'npm-token', value: 'secret' })).body).toEqual({
		version: 1,
	});
	expect(refusal(
		await elevated('/api/credentials/replace', {
			alias: 'npm-token',
			value: 'newer',
			expectedVersion: null,
		}),
	)).toEqual([409, 'npm-token changed since you checked it; review it again']);
	expect((await elevated('/api/credentials/reveal', { alias: 'npm-token' })).body).toEqual({
		value: 'secret',
		version: 1,
	});
	expect((await elevated('/api/credentials/grant', { selection })).body).toEqual({ granted: true });
	expect((await elevated('/api/credentials/sync', { alias: 'npm-token' })).body).toEqual([]);
	const listed = await api('/api/credentials');
	expect(listed.body).toMatchObject({
		credentials: [{ alias: 'npm-token', version: 1, active: 1 }],
		grants: [{ alias: 'npm-token', repositoryId: repository.id, delivery: 'runtime' }],
		deliveries: [],
	});
});

test('workflow credential delivery refuses an alias the stream does not request before it reads the vault', async () => {
	const read: string[] = [];
	const vault = {
		runtime: (alias: string) =>
			Effect.sync(() => {
				read.push(alias);
				return `${alias}-value`;
			}),
	};
	const run = {
		repositoryId: 42,
		repository: 'octo/widget',
		ref: 'refs/heads/main',
		workflowRef: 'octo/widget/.github/workflows/release.yml@refs/heads/main',
		runId: 7,
		attempt: 1,
	};
	expect(
		await Effect.runPromise(
			deliverCredentials(vault, { allowed: ['npm-token'], aliases: ['npm-token'], operation: 'promote', run }),
		),
	).toEqual({ 'npm-token': 'npm-token-value' });
	const exit = await Effect.runPromiseExit(
		deliverCredentials(vault, {
			allowed: ['npm-token'],
			aliases: ['npm-token', 'cargo-token'],
			operation: 'promote',
			run,
		}),
	);
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
	expect(error instanceof DomainError ? [error.problem.code, error.message] : error).toEqual([
		'forbidden',
		'Alias not requested by the stream',
	]);
	expect(read).toEqual(['npm-token', 'npm-token']);
});
