import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { botLogin, ownerId, ownerLogin } from '@root/test/support/github.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { RepositoryGateway } from '@/automation/github';
import { Automation } from '@/automation/service';

let world: World;
let repository: Repository;
eachWorld(created => {
	world = created;
	repository = world.github.create('octo/widget', { 'README.md': '# widget\n' });
});

const minutes = 60_000;

function calls(mark: number, method: string, path: RegExp): number {
	return world.network.since(mark).filter(exchange =>
		exchange.host === 'api.github.com' && exchange.method === method && path.test(new URL(exchange.url).pathname)
	).length;
}

function token(): Promise<string> {
	return world.run(
		Automation.use(service => service.gateway.token(repository.name, repository.id, { contents: 'read' })),
	);
}

test('requests in one isolate share an installation token until five minutes before it expires', async () => {
	const mark = world.network.mark();
	const first = await token();
	expect(await token()).toBe(first);
	world.advance(55 * minutes - 1000);
	expect(await token()).toBe(first);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(1);
	expect(calls(mark, 'GET', /\/installation$/)).toBe(3);
	world.advance(2000);
	const renewed = await token();
	expect(renewed).not.toBe(first);
	expect(await token()).toBe(renewed);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(2);
});

test('a slow repository check counts against the five-minute margin', async () => {
	let minted = false;
	world.network.serve('api.github.com', request => {
		const path = new URL(request.url).pathname;
		if (path.endsWith('/access_tokens')) minted = true;
		else if (minted && path === `/repos/${repository.name}`) {
			minted = false;
			world.advance(30_000);
		}
		return world.github.handle(request);
	});
	const first = await token();
	world.advance(55 * minutes - 30_000 + 1000);
	expect(await token()).not.toBe(first);
});

test('concurrent requests each fetch their own token instead of waiting on another request', async () => {
	let checks = 0;
	const { promise: bothChecked, resolve } = Promise.withResolvers<void>();
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		if (path.endsWith('/installation') && ++checks === 2) resolve();
		if (path.endsWith('/access_tokens')) await bothChecked;
		return world.github.handle(request);
	});
	const mark = world.network.mark();
	const [first, second] = await Promise.all([token(), token()]);
	expect(first).not.toBe(second);
	expect([first, second]).toContain(await token());
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(2);
});

test('requests in one isolate look up the owner login and the bot identity once', async () => {
	const mark = world.network.mark();
	const lookup = () =>
		world.run(
			Automation.use(service =>
				Effect.all([service.gateway.ownerLogin(), service.gateway.botIdentity.pipe(Effect.map(bot => bot.login))])
			),
		);
	expect(await lookup()).toEqual([ownerLogin, botLogin]);
	expect(await lookup()).toEqual([ownerLogin, botLogin]);
	expect(calls(mark, 'GET', /^\/app\/installations$/)).toBe(2);
	expect(calls(mark, 'GET', /^\/users\//)).toBe(1);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(1);
});

test('a gateway built outside the application layer mints its own token', async () => {
	const mark = world.network.mark();
	const issue = () =>
		Effect.runPromise(
			new RepositoryGateway(world.env, ownerId, world.network.fetch).token(repository.name, repository.id),
		);
	expect(await issue()).not.toBe(await issue());
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(2);
});

test('a suspended installation asks GitHub for a token instead of reusing one', async () => {
	await token();
	world.github.suspend();
	const refused = await world.run(
		Automation.use(service => service.gateway.token(repository.name, repository.id, { contents: 'read' })).pipe(
			Effect.flip,
		),
	);
	expect(refused.message).toContain('This installation has been suspended');
});

test('tokens minted for a workflow run are never reused', async () => {
	const mark = world.network.mark();
	const mint = () =>
		world.run(
			Automation.use(service => service.gateway.mintToken(repository.name, repository.id, { contents: 'read' })),
		);
	expect(await mint()).not.toBe(await mint());
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(2);
});
