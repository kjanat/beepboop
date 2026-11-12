import { expect, spyOn, test } from 'bun:test';
import { exchange, failureOf } from '@root/actions/runtime/protocol';
import { pullRequestTransport } from '@root/actions/runtime/pull-request';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client';
import { durableObjectState, MemoryStorage } from '@root/test/support/do-storage';
import { widget } from '@root/test/support/repositories';
import type { World } from '@root/test/support/world';
import { adminSubject, eachWorld, epoch, issuer, origin } from '@root/test/support/world';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Logger, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { decodeJwt } from 'jose';
import { administrator, workflowIdentity } from '@/automation/auth';
import { AutomationCoordinator } from '@/automation/coordinator';
import { logFailure } from '@/automation/failure-log';
import { RepositoryGateway } from '@/automation/github';
import { Automation } from '@/automation/service';
import { readEach } from '@/automation/store';
import { precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { semVer } from '@/contract/version';
import { configurationSchema } from '@/domain/configuration';
import { failure } from '@/failure';
import { encodeConfigurationV1, storedConfiguration } from '@/persistence/codecs/configuration';
import { decodeSync, encodeSync, mapped } from '@/schema';

let world: World;
eachWorld(created => {
	world = created;
});

test('requests and durable release preparation use supplied dependencies with global I/O disabled', async () => {
	const token = await world.cliSession();
	Object.defineProperty(world.env, 'DB', {
		get() {
			throw new Error('Raw database binding must not be used');
		},
	});
	const globalFetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(() => {
		throw new Error('Global fetch must not be used');
	}, { preconnect: fetch.preconnect }));
	const repository = await discoveredWidget(world, token);
	const send = cliTransport(world, token);
	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);
	const prepared = await call(routes.releasesPrepare, {
		repositoryId: repository.id,
		stream: 'main',
		version: '1.1.0',
		sourceSha: plan.sourceSha,
		planId: plan.planId,
	}, send);
	expect(prepared.state).toBe('ready');
	expect((await call(routes.executionsList, {}, send)).map(execution => execution.id)).toContain(prepared.id);
	expect((await world.coordinator(repository).execution(prepared.id))?.id).toBe(prepared.id);
	const cookie = await world.adminCookie();
	const security = await world.handle(
		new Request(`${origin}${routes.authenticatorsOptions.path}`, {
			method: 'POST',
			headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
			body: JSON.stringify({ register: true }),
		}),
	);
	expect(security.status).toBe(200);
	const jwks = await (await world.network.fetch(`${issuer}/.well-known/jwks.json`)).json();
	world.network.serve(new URL(issuer).host, request =>
		new URL(request.url).pathname === '/token'
			? Response.json({
				access_token: cookie.slice(cookie.indexOf('=') + 1),
				refresh_token: 'refresh',
				expires_in: 3600,
			})
			: Response.json(jwks));
	const login = await world.handle(new Request(`${origin}/auth/login`));
	expect(login.status).toBe(302);
	const location = new URL(login.headers.get('location') ?? '');
	const flowCookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
	const callback = await world.handle(
		new Request(`${origin}/auth/callback?code=test&state=${location.searchParams.get('state')}`, {
			headers: { Cookie: flowCookie },
		}),
	);
	expect(callback.status).toBe(302);
	expect(callback.headers.get('location')).toBe('/');
	expect(callback.headers.get('set-cookie')).toContain('__Host-beepboop_access=');
	expect(globalFetch).not.toHaveBeenCalled();
});

test('Action response readers cancel and release their locks on interruption', async () => {
	for (const path of ['success', 'failure', 'pull-request'] as const) {
		await Effect.runPromise(Effect.gen(function*() {
			const started = yield* Deferred.make<void>();
			let cancelled = false;
			const stream = new ReadableStream<Uint8Array>(
				{
					pull() {
						Deferred.doneUnsafe(started, Exit.void);
					},
					cancel() {
						cancelled = true;
					},
				},
				{ highWaterMark: 0 },
			);
			const response = new Response(stream, {
				status: path === 'failure' ? 502 : 200,
				headers: { 'Content-Type': 'application/json' },
			});
			const read = path === 'success'
				? exchange('begin', Effect.succeed(response))
				: path === 'failure'
				? failureOf(response)
				: pullRequestTransport('token', () => Promise.resolve(response))('GET', '/test');
			const fiber = yield* Effect.forkChild(read);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			expect(cancelled).toBe(true);
			expect(stream.locked).toBe(false);
		}));
	}
});

test('the pull-request Action aborts an in-flight request on interruption', async () => {
	await Effect.runPromise(Effect.gen(function*() {
		const started = yield* Deferred.make<void>();
		let signal: AbortSignal | null | undefined;
		const request = pullRequestTransport('token', (_url, init) => {
			signal = init?.signal;
			Deferred.doneUnsafe(started, Exit.void);
			return new Promise<Response>(() => {});
		})('GET', '/test');
		const fiber = yield* Effect.forkChild(request);
		yield* Deferred.await(started);
		yield* Fiber.interrupt(fiber);
		expect(signal?.aborted).toBe(true);
	}));
});

test('GitHub JWT issuance and both authentication paths follow the supplied clock', async () => {
	const repository = widget(world.github);
	const workflowToken = await world.runToken({ repository, runId: 1, sha: 'a'.repeat(40), file: 'publish.yml' });
	const cookie = await world.adminCookie();
	const workflowRequest = new Request(origin, { headers: { Authorization: `Bearer ${workflowToken}` } });
	const adminRequest = new Request(origin, { headers: { Cookie: cookie } });
	const issued: ReturnType<typeof decodeJwt>[] = [];
	const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID), (_url, init) => {
		issued.push(decodeJwt(new Headers(init?.headers).get('authorization')?.slice(7) ?? ''));
		return Promise.resolve(Response.json({ message: 'Stop after inspecting the JWT' }, { status: 401 }));
	});
	await Effect.runPromise(
		Effect.gen(function*() {
			const service = yield* Automation;
			yield* TestClock.setTime(epoch);
			expect(yield* administrator(adminRequest, world.env, service.authentication)).toBe(adminSubject);
			expect(
				(yield* workflowIdentity(
					workflowRequest,
					origin,
					Number(world.env.OWNER_ID),
					service.authentication.workflowKeys,
				)).runId,
			).toBe(1);
			yield* gateway.token(repository.name, repository.id).pipe(Effect.result);
			yield* TestClock.adjust('61 minutes');
			for (
				const check of [
					administrator(adminRequest, world.env, service.authentication).pipe(Effect.asVoid),
					workflowIdentity(workflowRequest, origin, Number(world.env.OWNER_ID), service.authentication.workflowKeys)
						.pipe(Effect.asVoid),
				]
			) {
				const result = yield* Effect.result(check.pipe(Effect.asVoid));
				expect(Result.isFailure(result) && result.failure.problem.code).toBe('unauthenticated');
			}
			yield* gateway.token(repository.name, repository.id).pipe(Effect.result);
		}).pipe(Effect.provide(Layer.merge(world.application, TestClock.layer()))),
	);
	expect(issued.map(token => [token.iat, token.exp])).toEqual([
		[epoch / 1000 - 60, epoch / 1000 + 540],
		[epoch / 1000 + 3660 - 60, epoch / 1000 + 3660 + 540],
	]);
});

test('normalization codecs validate their output and round-trip canonical persisted configuration', () => {
	const version = decodeSync(semVer, 'v1.2.3');
	expect(encodeSync(semVer, version)).toBe('1.2.3');
	expect(Schema.encodeUnknownResult(semVer)('not a version')._tag).toBe('Failure');
	const broken = mapped(Schema.String, Schema.String, () => JSON.parse('42'), value => value);
	expect(() => decodeSync(broken, 'input')).toThrow();
	const configuration = decodeSync(configurationSchema, {
		streams: {
			main: {
				promote: {
					workflow: {
						file: 'publish.yml',
						setup: { existingTriggers: 'replace-with-dispatch', commands: 'npm publish' },
					},
				},
			},
		},
	});
	const stored = encodeConfigurationV1(configuration);
	expect(decodeSync(storedConfiguration, stored)).toEqual(configuration);
	expect(decodeSync(configurationSchema, encodeSync(configurationSchema, configuration))).toEqual(configuration);
	expect(
		Schema.encodeUnknownResult(storedConfiguration)({ ...configuration, streams: { main: { versioning: 42 } } })._tag,
	).toBe('Failure');
});

test('unreadable stored data stays recoverable while decoder defects escape', async () => {
	const read = (decode: (source: string) => unknown) =>
		Effect.sync(() => readEach(['{'], decode, (_row, error) => ({ kind: 'unreadable', error })));
	expect(await Effect.runPromise(read(JSON.parse))).toEqual([expect.objectContaining({ kind: 'unreadable' })]);
	const bug = new TypeError('decoder bug');
	const exit = await Effect.runPromiseExit(read(() => {
		throw bug;
	}));
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	const repository = widget(world.github);
	const instance = world.coordinators.instance(String(repository.id));
	const value = {
		get id() {
			throw bug;
		},
	};
	spyOn(instance.storage, 'list').mockResolvedValue(new Map([['execution:broken', value]]));
	const rejected: unknown = await instance.object.preparationResults('main', '1.0.0').catch(error => error);
	expect(rejected).toBeInstanceOf(Error);
	expect(rejected instanceof Error && Cause.isCause(rejected.cause) && Cause.hasDies(rejected.cause)).toBe(true);
});

test('failure logs preserve causes and use the supplied application logger', async () => {
	const events: unknown[][] = [];
	const logger = Logger.make(({ message, cause }) => {
		events.push([...(Array.isArray(message) ? message : [message]), cause]);
	});
	const defect = new Error('decoder failed', { cause: new Error('root cause') });
	const response = await Effect.runPromise(
		Effect.gen(function*() {
			yield* logFailure('retry.exhausted', precondition('expected failure'), { repositoryId: 1 });
			return yield* failure(new Request(`${origin}/api/test`), defect, Cause.die(defect));
		}).pipe(Effect.provide(Logger.layer([logger]))),
	);
	expect(response.status).toBe(500);
	expect(events.map(event => event[0])).toEqual(['retry.exhausted', 'request.failed']);
	expect(events[1]?.some(value => Cause.isCause(value) && Cause.pretty(value).includes('root cause'))).toBe(true);
	expect(await response.text()).not.toContain('root cause');
});

test('durable inbox timestamps and alarms use the supplied clock across RPC calls', async () => {
	const storage = new MemoryStorage();
	await Effect.runPromise(
		Effect.gen(function*() {
			const clock = yield* Clock.Clock;
			const coordinator = new AutomationCoordinator(
				durableObjectState('1', storage),
				world.env,
				Layer.merge(world.application, Layer.succeed(Clock.Clock, clock)),
			);
			yield* TestClock.setTime(5000);
			yield* Effect.promise(() => coordinator.receive('first', 1, { kind: 'push', ref: 'refs/heads/main' }));
			expect(storage.alarm).toBe(5000);
			yield* TestClock.adjust(1000);
			yield* Effect.promise(() => coordinator.receive('second', 1, { kind: 'push', ref: 'refs/heads/main' }));
			expect(storage.snapshot().get('inbox:first')).toMatchObject({ due: 5000 });
			expect(storage.snapshot().get('inbox:second')).toMatchObject({ due: 6000 });
		}).pipe(Effect.provide(TestClock.layer())),
	);
});
