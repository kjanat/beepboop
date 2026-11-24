import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { botLogin, ownerId, ownerLogin } from '@root/test/support/github.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { RepositoryGateway } from '@/automation/gateway.ts';
import { Automation } from '@/automation/service';
import { isolateGitHubApp } from '@/github/app.ts';

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

function read(target: Repository, issued: string): Promise<unknown> {
	return world.run(Automation.use(service => service.gateway.call(`/repos/${target.name}`, issued)));
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

test('each repository reads with a token of its own', async () => {
	const other = world.github.create('octo/gadget', { 'README.md': '# gadget\n' });
	const first = await token();
	expect(await read(other, first)).toBeNull();
	const second = await world.run(
		Automation.use(service => service.gateway.token(other.name, other.id, { contents: 'read' })),
	);
	expect(await read(other, second)).toMatchObject({ full_name: other.name });
});

test('a request an hour later reads with a token GitHub still accepts', async () => {
	const first = await token();
	world.advance(60 * minutes);
	expect(await read(repository, await token())).toMatchObject({ full_name: repository.name });
	const refused = await world.run(
		Automation.use(service => service.gateway.call(`/repos/${repository.name}`, first)).pipe(Effect.flip),
	);
	expect(refused.message).toContain('HTTP 401');
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

test('a cached token that GitHub rejects is replaced by the next request', async () => {
	const first = await token();
	world.network.serve('api.github.com', request =>
		request.headers.get('authorization') === `Bearer ${first}`
			? Response.json({ message: 'Bad credentials' }, { status: 401 })
			: world.github.handle(request));
	const refused = await world.run(
		Automation.use(service => service.gateway.call(`/repos/${repository.name}`, first)).pipe(Effect.flip),
	);
	expect(refused.message).toContain('HTTP 401');
	const mark = world.network.mark();
	const renewed = await token();
	expect(renewed).not.toBe(first);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(1);
	expect(await token()).toBe(renewed);
});

test('permission order does not split the token cache', async () => {
	const mark = world.network.mark();
	const issue = (permissions: Record<string, 'read' | 'write'>) =>
		world.run(Automation.use(service => service.gateway.token(repository.name, repository.id, permissions)));
	const first = await issue({ contents: 'read', actions: 'read' });
	expect(await issue({ actions: 'read', contents: 'read' })).toBe(first);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(1);
});

test('a failed mint is not cached', async () => {
	let refuse = true;
	world.network.serve('api.github.com', request => {
		if (refuse && request.method === 'POST' && new URL(request.url).pathname.endsWith('/access_tokens')) {
			refuse = false;
			return Response.json({ message: 'Server Error' }, { status: 422 });
		}
		return world.github.handle(request);
	});
	await expect(token()).rejects.toThrow();
	expect(await token()).toStartWith('ghs_');
});

test('replacing the private key replaces the isolate app', () => {
	const fetcher = world.network.fetch;
	const credentials = {
		GITHUB_APP_ID: world.env.GITHUB_APP_ID,
		GITHUB_APP_PRIVATE_KEY: world.env.GITHUB_APP_PRIVATE_KEY,
	};
	const first = isolateGitHubApp(fetcher, credentials, ownerId);
	expect(isolateGitHubApp(fetcher, { ...credentials }, ownerId)).toBe(first);
	expect(isolateGitHubApp(fetcher, { ...credentials, GITHUB_APP_PRIVATE_KEY: 'replacement' }, ownerId)).not.toBe(first);
});

test('unsuspending an installation does not bring back a token cached before the suspension', async () => {
	const first = await token();
	world.github.suspend();
	await world.run(
		Automation.use(service => service.gateway.token(repository.name, repository.id, { contents: 'read' })).pipe(
			Effect.flip,
		),
	);
	world.github.unsuspend();
	const mark = world.network.mark();
	const renewed = await token();
	expect(renewed).not.toBe(first);
	expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(1);
});

test('tokens without an expiry GitHub states in ISO 8601 are never reused', async () => {
	for (const expiresAt of [undefined, 'soon', '3600', '2999-01-01']) {
		world.network.serve('api.github.com', async request => {
			const response = await world.github.handle(request);
			if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/access_tokens')) return response;
			const issued: Record<string, unknown> = await response.json();
			if (expiresAt === undefined) delete issued['expires_at'];
			else issued['expires_at'] = expiresAt;
			return Response.json(issued, { status: 201 });
		});
		const mark = world.network.mark();
		expect(await token()).not.toBe(await token());
		expect(calls(mark, 'POST', /\/access_tokens$/)).toBe(2);
	}
});

test('a token lasts at most an hour whatever expiry GitHub states', async () => {
	world.network.serve('api.github.com', async request => {
		const response = await world.github.handle(request);
		if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/access_tokens')) return response;
		const issued: Record<string, unknown> = await response.json();
		issued['expires_at'] = new Date(Date.now() + 24 * 60 * minutes).toISOString();
		return Response.json(issued, { status: 201 });
	});
	const first = await token();
	world.advance(56 * minutes);
	expect(await token()).not.toBe(first);
});

test('a repository recreated under the same name gets its own token', async () => {
	const identify = () => world.run(Automation.use(service => service.gateway.token(repository.name, undefined)));
	const first = await identify();
	expect(await identify()).not.toBe(first);
	const old = repository;
	world.github.repositories.delete(old.name);
	const recreated = world.github.create(old.name, { 'README.md': '# widget\n' });
	expect(recreated.id).not.toBe(old.id);
	const mint = (id: number) =>
		world.run(Automation.use(service => service.gateway.token(old.name, id, { contents: 'read' })));
	expect(await mint(recreated.id)).not.toBe(first);
});

test('the owner login is looked up again after an hour', async () => {
	const lookup = () => world.run(Automation.use(service => service.gateway.ownerLogin()));
	const mark = world.network.mark();
	await lookup();
	world.advance(59 * minutes);
	await lookup();
	expect(calls(mark, 'GET', /^\/app\/installations$/)).toBe(1);
	world.advance(2 * minutes);
	await lookup();
	expect(calls(mark, 'GET', /^\/app\/installations$/)).toBe(2);
});

test('the installation of the owner is found past the first page', async () => {
	world.network.serve('api.github.com', request => {
		const url = new URL(request.url);
		if (url.pathname !== '/app/installations' || url.searchParams.get('page') !== '1') {
			return world.github.handle(request);
		}
		return Response.json(
			Array.from({ length: 100 }, (_, index) => ({
				id: 50_000 + index,
				account: { id: 90_000 + index, login: `other${index}` },
			})),
		);
	});
	expect(await world.run(Automation.use(service => service.gateway.ownerLogin()))).toBe(ownerLogin);
});
