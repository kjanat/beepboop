import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { applyVersionFiles } from '@/automation/editors';
import { GitHub, gitHubRequest } from '@/automation/github';
import { latestVersion, registryRequest } from '@/automation/managers/verification';
import {
	ApplicationConfiguration,
	ApplicationSecrets,
	Automation,
	automationLayer,
	HttpTransport,
} from '@/automation/service';
import { Store } from '@/automation/store';
import { Vault } from '@/automation/vault';
import { call, send } from '@/contract/client';
import { precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { https } from '@/distribution/assets';
import { classify, fromSync, recover } from '@/failure';
import { CredentialStore } from '@/persistence/d1/credentials';
import type { Sql } from '@/persistence/d1/database';
import { Database } from '@/persistence/d1/database';
import { SessionStore } from '@/persistence/d1/sessions';
import { retryTransient } from '@/runtime/policy';
import { capture } from '@/tooling/runtime';
import { readBody } from '@/webhook';

test('recovery handles typed failures and preserves defects and interruption', async () => {
	const recovered = recover(() => Effect.succeed('recovered'));
	expect(await Effect.runPromise(Effect.fail(precondition('expected')).pipe(recovered))).toBe('recovered');
	for (const effect of [Effect.die(new Error('decoder bug')), Effect.interrupt]) {
		const exit = await Effect.runPromiseExit(effect.pipe(recovered));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) expect(Cause.hasDies(exit.cause) || Cause.hasInterrupts(exit.cause)).toBe(true);
	}
	for (const bug of [new Error('decoder bug'), new TypeError('unexpected programmer error')]) {
		const exit = await Effect.runPromiseExit(
			fromSync(() => {
				throw bug;
			}).pipe(recovered),
		);
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
		expect(classify(bug, 'incident').problem).toEqual({ code: 'internal', incident: 'incident' });
	}
});

test('malformed release URLs remain recoverable input failures', async () => {
	for (const value of ['not a URL', 'https://', 'http://example.com/tool.zip', 'https://user@example.com/tool.zip']) {
		const result = await Effect.runPromise(https(value).pipe(Effect.result));
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(await Effect.runPromise(https(value).pipe(recover(error => Effect.succeed(error.message)))))
			.toBe('Expected an HTTPS release URL');
	}
	expect(await Effect.runPromise(https('https://example.com/tool.zip'))).toBe('https://example.com/tool.zip');
});

test('invalid original and edited TOML version files remain recoverable input failures', async () => {
	const valid = '[package]\nversion = "1.0.0"\n';
	const malformed = '[package\nversion = "1.0.0"\n';
	for (const [original, current] of [[malformed, malformed], [valid, malformed]] as const) {
		const files = { 'Cargo.toml': current };
		const result = await Effect.runPromise(
			applyVersionFiles(
				{
					repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
					sha: 'a'.repeat(40),
					files: { 'Cargo.toml': original },
					paths: ['Cargo.toml'],
				},
				files,
				[{ path: 'Cargo.toml', format: 'toml', key: ['package', 'version'], template: '{version}' }],
				{
					release: '1.1.0',
				},
			).pipe(Effect.result),
		);
		expect(Result.isFailure(result) && result.failure.problem.code).toBe('precondition');
		expect(Result.isFailure(result) && result.failure.message).toContain('Invalid TOML');
		expect(files['Cargo.toml']).toBe(current);
	}
});

test('registry decoder defects remain observable instead of becoming outages', async () => {
	const exit = await Effect.runPromiseExit(latestVersion(
		() => Promise.resolve(Response.json({ version: '1.0.0' })),
		'https://registry.test/package',
		() => {
			throw new Error('decoder bug');
		},
	));
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	const outage = await Effect.runPromise(latestVersion(
		() => Promise.reject(new Error('connection reset')),
		'https://registry.test/package',
		() => '1.0.0',
	));
	expect(outage.kind).toBe('failed');
});

test('malformed successful API responses are typed failures', async () => {
	for (const body of ['{', '{"proof":42}']) {
		const response = new Response(body, { headers: { 'Content-Type': 'application/json' } });
		const result = await Effect.runPromise(
			Effect.result(
				call(routes.authenticatorsVerify, { id: 'challenge', response: {} }, () => Effect.succeed(response)),
			),
		);
		expect(Result.isFailure(result) && result.failure._tag).toBe('ApiFailure');
	}
});

test('interruption aborts client, GitHub and registry transports', async () => {
	for (const adapter of ['client', 'github', 'registry'] as const) {
		await Effect.runPromise(Effect.gen(function*() {
			const started = yield* Deferred.make<void>();
			let aborted = false;
			const transport = (_url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
				Deferred.doneUnsafe(started, Exit.void);
				return new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => {
						aborted = true;
						reject(new Error('aborted'));
					}, { once: true });
				});
			};
			const work = adapter === 'client'
				? send(signal => transport('https://test', { signal }))
				: adapter === 'github'
				? gitHubRequest(transport, '/test', '')
				: registryRequest(transport, 'https://test');
			const fiber = yield* Effect.forkChild(work);
			yield* Deferred.await(started);
			yield* Fiber.interrupt(fiber);
			expect(aborted).toBe(true);
		}));
	}
});

test('session expiry reads the supplied clock when the operation runs', async () => {
	const writes: unknown[][] = [];
	const sql: Sql = {
		statement: () => {
			throw new Error('not used');
		},
		first: () => Effect.succeed(null),
		all: () => Effect.succeed([]),
		run: (_query, ...values) =>
			Effect.sync(() => {
				writes.push(values);
				return { results: [], meta: { changes: 1 } };
			}),
		batch: () => Effect.succeed([]),
	};
	const open = new SessionStore(sql).open('login-flow', 'id', {}, 5000);
	await Effect.runPromise(
		Effect.gen(function*() {
			yield* TestClock.setTime(1000);
			yield* open;
			yield* TestClock.adjust(2000);
			yield* open;
		}).pipe(Effect.provide(TestClock.layer())),
	);
	expect(writes.map(values => values.at(-1))).toEqual([6000, 8000]);
});

test('interrupting a subprocess waits for its termination', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-interruption-'));
	const ready = join(directory, 'ready');
	const stopped = join(directory, 'stopped');
	try {
		const script =
			"const fs = require('node:fs'); const [, stopped, ready] = process.argv; process.on('SIGTERM', () => { fs.writeFileSync(stopped, 'stopped'); process.exit(0); }); fs.writeFileSync(ready, 'ready'); setInterval(() => {}, 100);";
		await Effect.runPromise(Effect.gen(function*() {
			const fiber = yield* Effect.forkChild(capture([process.execPath, '-e', script, stopped, ready]));
			yield* Effect.tryPromise(async () => {
				for (let attempt = 0; attempt < 200; attempt++) {
					if (await Bun.file(ready).exists()) return;
					await Bun.sleep(10);
				}
				throw new Error('Child did not start');
			});
			yield* Fiber.interrupt(fiber);
		}));
		expect(await readFile(stopped, 'utf8')).toBe('stopped');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('the application layer uses explicitly supplied database, GitHub, HTTP and secrets services', async () => {
	const queries: string[] = [];
	const sql: Sql = {
		statement: () => {
			throw new Error('unexpected statement');
		},
		first: () => Effect.succeed(null),
		all: () => Effect.succeed([]),
		batch: () => Effect.succeed([]),
		run: query =>
			Effect.sync(() => {
				queries.push(query);
				return { results: [], meta: { changes: 1 } };
			}),
	};
	const vault = new Vault(new Store(sql), new CredentialStore(sql), {}, 'test');
	const http = () => Promise.resolve(Response.json({ injected: 'http' }));
	const calls: string[] = [];
	const supplied = Layer.mergeAll(
		Layer.succeed(Database, sql),
		Layer.succeed(GitHub, {
			call: path =>
				Effect.sync(() => {
					calls.push(path);
					return { injected: 'github' };
				}),
		}),
		Layer.succeed(HttpTransport, { fetch: http }),
		Layer.succeed(ApplicationSecrets, vault),
		Layer.succeed(ApplicationConfiguration, {
			env: {
				get DB(): never {
					throw new Error('Database must be supplied by the layer');
				},
				get AUTOMATION(): never {
					throw new Error('Unused durable binding');
				},
				OWNER_ID: '1',
				GITHUB_APP_ID: 'test',
				GITHUB_APP_PRIVATE_KEY: '',
				GITHUB_WEBHOOK_SECRET: '',
				VAULT_KEYS: 'must not be read',
				VAULT_ACTIVE_KEY: '',
				APPLICATION_ORIGIN: 'https://test',
				OPENAUTH_ISSUER: 'https://issuer.test',
				OPENAUTH_CLIENT_ID: 'test',
				ADMIN_SUBJECT: 'test',
			},
		}),
	);
	await Effect.runPromise(
		Effect.gen(function*() {
			const service = yield* Automation;
			expect(yield* service.gateway.call('/injected', 'token')).toEqual({ injected: 'github' });
			yield* service.sessions.open('login-flow', 'id', {}, 1000);
			expect(service.dependencies.transport).toBe(http);
			expect(service.vault()).toBe(vault);
		}).pipe(Effect.provide(automationLayer.pipe(Layer.provide(supplied)))),
	);
	expect(calls).toEqual(['/injected']);
	expect(queries).toHaveLength(1);
});

test('transient retry uses the supplied clock and does not retry defects', async () => {
	const attempts: number[] = [];
	await Effect.runPromise(
		Effect.gen(function*() {
			const clock = yield* Clock.Clock;
			const work = Effect.suspend(() => {
				attempts.push(clock.currentTimeMillisUnsafe());
				return attempts.length < 3 ? Effect.fail('transient') : Effect.succeed('done');
			}).pipe(retryTransient({ attempts: 3, delay: 500, while: error => error === 'transient' }));
			yield* TestClock.setTime(1000);
			const fiber = yield* Effect.forkChild(work);
			yield* TestClock.adjust(500);
			yield* TestClock.adjust(1000);
			expect(yield* Fiber.join(fiber)).toBe('done');
		}).pipe(Effect.provide(TestClock.layer())),
	);
	expect(attempts).toEqual([1000, 1500, 2500]);
	let runs = 0;
	const exit = await Effect.runPromiseExit(
		Effect.sync(() => {
			runs++;
			throw new Error('bug');
		}).pipe(
			retryTransient({ attempts: 3, delay: 0, while: () => true }),
		),
	);
	expect(runs).toBe(1);
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
});

test('request interruption cancels and releases a body reader', async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		cancel() {
			cancelled = true;
		},
	});
	const request = new Request('https://test/webhooks/github', { method: 'POST', body });
	await Effect.runPromise(Effect.gen(function*() {
		const fiber = yield* Effect.forkChild(readBody(request));
		yield* Effect.yieldNow;
		yield* Fiber.interrupt(fiber);
	}));
	expect(cancelled).toBe(true);
	expect(body.locked).toBe(false);
});

test('interruption after HTTP headers arrive cancels the response body', async () => {
	let cancelled = false;
	const started = Deferred.makeUnsafe<void>();
	const body = new ReadableStream<Uint8Array>({
		pull() {
			Deferred.doneUnsafe(started, Exit.void);
		},
		cancel() {
			cancelled = true;
		},
	});
	await Effect.runPromise(Effect.gen(function*() {
		const fiber = yield* Effect.forkChild(
			call(routes.authenticatorsVerify, { id: 'challenge', response: {} }, () =>
				Effect.succeed(
					new Response(body, { headers: { 'Content-Type': 'application/json' } }),
				)),
		);
		yield* Deferred.await(started);
		yield* Effect.yieldNow;
		yield* Fiber.interrupt(fiber);
	}));
	expect(cancelled).toBe(true);
	expect(body.locked).toBe(false);
});

test('an errored response stream remains a typed failure during reader cleanup', async () => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.error(new Error('connection reset'));
		},
	});
	const exit = await Effect.runPromiseExit(
		call(routes.authenticatorsVerify, { id: 'challenge', response: {} }, () =>
			Effect.succeed(
				new Response(body, { headers: { 'Content-Type': 'application/json' } }),
			)),
	);
	expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true);
	expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(false);
	expect(body.locked).toBe(false);
});
