import { expect, test } from 'bun:test';
import { Deferred, Effect, Exit, Fiber, Result } from 'effect';
import { exportPKCS8, generateKeyPair } from 'jose';
import { gitHubRequest, RepositoryGateway } from '@/automation/github';
import { goManager } from '@/automation/managers/go';
import { jsrManager, setUpJsrPackage } from '@/automation/managers/jsr';
import { npmLatest } from '@/automation/managers/npm';
import { pypiManager } from '@/automation/managers/pypi';
import type { Fetcher, Manager } from '@/automation/managers/registry';
import { registryLayer } from '@/automation/managers/registry';
import { verifyRegistry } from '@/automation/managers/verification';
import { vscodeManager } from '@/automation/managers/vscode';
import type { Publication } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { responseJson, scopedResponse } from '@/runtime/http';

function openResponse(status: number, cancel: () => void) {
	return new Response(new ReadableStream<Uint8Array>({ cancel }), { status });
}
function publication(manager: Publication['manager'], name: string): Publication {
	return { id: name, manager, name, version: '1.0.0', outcome: 'pending', required: true };
}

test('missing GitHub files and registry lookups release unused bodies', async () => {
	let cancellations = 0;
	const request: Fetcher = async () => openResponse(404, () => cancellations++);
	expect(await Effect.runPromise(gitHubRequest(request, '/repos/o/r/contents/missing', ''))).toBeNull();
	expect((await Effect.runPromise(npmLatest('widget', request))).kind).toBe('missing');
	expect(cancellations).toBe(2);
});

for (
	const [manager, name, status] of [
		[goManager, 'example.com/widget', 410],
		[pypiManager, 'widget', 404],
		[vscodeManager, 'octo.widget', 503],
		[jsrManager, '@octo/widget', 404],
	] satisfies [Manager, string, number][]
) {
	test(`${manager.name} verification releases early-return responses`, async () => {
		let cancelled = false;
		const verify = manager.verifyPublication;
		if (!verify) throw new Error('Missing verifier');
		await Effect.runPromise(verify(publication(manager.name, name), async () => openResponse(status, () => {
			cancelled = true;
		})));
		expect(cancelled).toBe(true);
	});
}

test('channel verification releases rejected response after consuming version metadata', async () => {
	let calls = 0, cancelled = false;
	const result = await Effect.runPromise(verifyRegistry(
		{ ...publication('npm', 'widget'), channel: 'next' },
		async () =>
			++calls === 1
				? Response.json({ name: 'widget', version: '1.0.0', digest: 'digest' })
				: openResponse(429, () => {
					cancelled = true;
				}),
		'https://registry.test/widget/1.0.0',
		body => {
			if (typeof body !== 'object' || body === null) throw new Error('Invalid fixture');
			return {
				name: Reflect.get(body, 'name'),
				version: Reflect.get(body, 'version'),
				digest: Reflect.get(body, 'digest'),
			};
		},
		'https://registry.test/widget/tags',
	));
	expect(result.outcome).toBe('pending');
	expect(calls).toBe(2);
	expect(cancelled).toBe(true);
});

test('GitHub read retries release prior bodies and preserve final server error detail', async () => {
	const responses: Response[] = [];
	const result = await Effect.runPromise(Effect.result(gitHubRequest(
		async () => {
			for (const response of responses) expect(response.bodyUsed).toBe(true);
			const response = Response.json({ message: `server attempt ${responses.length + 1}` }, { status: 503 });
			responses.push(response);
			return response;
		},
		'/repos/o/r',
		'',
	)));
	expect(responses).toHaveLength(3);
	expect(Result.isFailure(result) && result.failure.message).toContain('server attempt 3');
	expect(responses.every(response => response.bodyUsed && !response.body?.locked)).toBe(true);
});

test('GitHub mutations are attempted once and preserve their error', async () => {
	let calls = 0;
	const result = await Effect.runPromise(Effect.result(gitHubRequest(
		async () => {
			calls++;
			return Response.json({ message: 'mutation failed' }, { status: 503 });
		},
		'/repos/o/r/git/refs',
		'',
		'POST',
		{ ref: 'refs/heads/example' },
	)));
	expect(calls).toBe(1);
	expect(Result.isFailure(result) && result.failure.message).toContain('mutation failed');
});

test('scoped response cleanup preserves primary failure when cancellation rejects', async () => {
	const result = await Effect.runPromise(Effect.result(
		Effect.gen(function*() {
			yield* scopedResponse(Effect.succeed(openResponse(400, () => {
				throw new Error('cleanup failed');
			})));
			return yield* Effect.fail('primary failure');
		}).pipe(Effect.scoped),
	));
	expect(result).toEqual(Result.fail('primary failure'));
});

test('interruption during scoped body reading releases its lock and cancels stream', async () => {
	await Effect.runPromise(Effect.gen(function*() {
		const started = yield* Deferred.make<void>();
		let cancelled = false;
		const response = new Response(new ReadableStream<Uint8Array>(
			{
				pull() {
					Deferred.doneUnsafe(started, Exit.void);
				},
				cancel() {
					cancelled = true;
				},
			},
			{ highWaterMark: 0 },
		));
		const fiber = yield* Effect.forkChild(
			Effect.gen(function*() {
				return yield* responseJson(yield* scopedResponse(Effect.succeed(response)));
			}).pipe(Effect.scoped),
		);
		yield* Deferred.await(started);
		yield* Fiber.interrupt(fiber);
		expect(cancelled).toBe(true);
		expect(response.body?.locked).toBe(false);
	}));
});

test('JSR setup releases successful mutation bodies', async () => {
	let cancelled = 0;
	await Effect.runPromise(
		setUpJsrPackage('@octo/widget', 'octo/widget', 'synthetic').pipe(
			Effect.provide(registryLayer(async (_input, init) =>
				init?.method === 'GET'
					? Response.json({ githubRepository: { owner: 'octo', name: 'widget' } })
					: openResponse(200, () => cancelled++)
			)),
		),
	);
	expect(cancelled).toBe(1);
});

test('Contents requests preserve literal path segments and pinned revision', async () => {
	for (const path of ['packages/a#b/package.json', 'packages/a?b/package.json', 'packages/a%2Fb/package.json']) {
		const gateway = new RepositoryGateway(
			{ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' },
			1,
			async input => {
				const url = new URL(String(input));
				expect(url.pathname.slice('/repos/o/r/contents/'.length).split('/').map(decodeURIComponent).join('/')).toBe(
					path,
				);
				expect(url.searchParams.get('ref')).toBe('a'.repeat(40));
				expect(url.hash).toBe('');
				return Response.json({ encoding: 'base64', content: btoa('literal content'), size: 15 });
			},
		);
		expect(await Effect.runPromise(gateway.file('o/r', path, 'a'.repeat(40), ''))).toBe('literal content');
	}
});

class TokenGateway extends RepositoryGateway {
	issued = 0;
	work: Effect.Effect<string, DomainError> = Effect.succeed('synthetic-token');
	constructor() {
		super({ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' }, 1, async () => Response.json({ ok: true }));
	}
	override token() {
		return Effect.suspend(() => {
			this.issued++;
			return this.work;
		});
	}
}

test('parallel verification reads share issuance and subsequent successful token', async () => {
	const gateway = new TokenGateway();
	gateway.work = Effect.succeed('token').pipe(Effect.delay(5));
	const verification = gateway.verification('o/r', 1);
	await Effect.runPromise(
		Effect.forEach(Array.from({ length: 8 }), () => verification.github('/repos/o/r'), { concurrency: 8 }),
	);
	await Effect.runPromise(verification.github('/repos/o/r'));
	expect(gateway.issued).toBe(1);
});

test('failed verification token issuance can retry', async () => {
	const gateway = new TokenGateway();
	gateway.work = Effect.fail(precondition('mint refused'));
	const verification = gateway.verification('o/r', 1);
	const first = await Effect.runPromise(Effect.result(verification.github('/repos/o/r')));
	expect(Result.isFailure(first)).toBe(true);
	gateway.work = Effect.succeed('token');
	await Effect.runPromise(verification.github('/repos/o/r'));
	expect(gateway.issued).toBe(2);
});

test('interrupting one token waiter preserves another; interrupting all allows fresh issuance', async () => {
	for (const interruptAll of [false, true]) {
		await Effect.runPromise(Effect.gen(function*() {
			const gateway = new TokenGateway();
			const started = yield* Deferred.make<void>();
			const completed = yield* Deferred.make<string>();
			gateway.work = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(completed)));
			const verification = gateway.verification('o/r', 1);
			const first = yield* Effect.forkChild(verification.github('/repos/o/r'));
			yield* Deferred.await(started);
			const second = yield* Effect.forkChild(verification.github('/repos/o/r'));
			yield* Effect.yieldNow;
			yield* Fiber.interrupt(first);
			if (interruptAll) {
				yield* Fiber.interrupt(second);
				gateway.work = Effect.succeed('fresh token');
				yield* verification.github('/repos/o/r');
				expect(gateway.issued).toBe(2);
			} else {
				yield* Deferred.succeed(completed, 'shared token');
				yield* Fiber.join(second);
				expect(gateway.issued).toBe(1);
			}
		}));
	}
});

test('parallel verification performs one real installation validation and token mint', async () => {
	const { privateKey } = await generateKeyPair('RS256', { extractable: true });
	const routes: string[] = [];
	const gateway = new RepositoryGateway(
		{ GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: await exportPKCS8(privateKey) },
		1,
		async (input, init) => {
			const path = new URL(String(input)).pathname;
			routes.push(path);
			if (path === '/repos/o/r/installation') {
				return Response.json({ id: 2, account: { id: 1, login: 'o' }, permissions: { contents: 'read' } });
			}
			if (path === '/app/installations/2/access_tokens') {
				expect(init?.method).toBe('POST');
				expect(JSON.parse(String(init?.body))).toEqual({ repository_ids: [3], permissions: { contents: 'read' } });
				return Response.json({ token: 'synthetic-token' });
			}
			if (path === '/repos/o/r') {
				return Response.json({ id: 3, full_name: 'o/r', owner: { id: 1 }, default_branch: 'master' });
			}
			expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
			return Response.json({ ok: true });
		},
	);
	const verification = gateway.verification('o/r', 3, { contents: 'read' });
	await Effect.runPromise(
		Effect.forEach(Array.from({ length: 8 }), () => verification.github('/repos/o/r/releases/latest'), {
			concurrency: 8,
		}),
	);
	expect(routes.filter(path => path === '/repos/o/r/installation')).toHaveLength(1);
	expect(routes.filter(path => path === '/app/installations/2/access_tokens')).toHaveLength(1);
	expect(routes.filter(path => path === '/repos/o/r')).toHaveLength(1);
	expect(routes.filter(path => path === '/repos/o/r/releases/latest')).toHaveLength(8);
});

test('release asset copying releases successful uploads and rejected downloads', async () => {
	for (const failedDownload of [false, true]) {
		let cancelled = 0, requests = 0;
		const gateway = new RepositoryGateway({ GITHUB_APP_ID: 'synthetic', GITHUB_APP_PRIVATE_KEY: '' }, 1, async () => {
			requests++;
			return requests === 1 && !failedDownload
				? new Response('asset bytes')
				: openResponse(failedDownload ? 503 : 201, () => cancelled++);
		});
		const result = await Effect.runPromise(
			Effect.result(
				gateway.copyReleaseAsset('o/r', { id: 1, name: 'asset.zip', contentType: 'application/zip' }, 2, 'synthetic'),
			),
		);
		expect(Result.isFailure(result)).toBe(failedDownload);
		expect(cancelled).toBe(1);
		expect(requests).toBe(failedDownload ? 1 : 2);
	}
});

test('only explicitly read-only GraphQL queries opt into POST retries', async () => {
	let requests = 0;
	const transport: Fetcher = async () =>
		++requests === 1
			? Response.json({ message: 'temporary outage' }, { status: 503 })
			: Response.json({ data: { repository: {} } });
	expect(
		await Effect.runPromise(
			gitHubRequest(transport, '/graphql', '', 'POST', { query: 'query { viewer { login } }' }, true),
		),
	)
		.toEqual({ data: { repository: {} } });
	expect(requests).toBe(2);
	const rejected = await Effect.runPromise(
		Effect.result(gitHubRequest(transport, '/graphql', '', 'POST', { query: 'mutation { example }' }, true)),
	);
	expect(Result.isFailure(rejected)).toBe(true);
	expect(requests).toBe(2);
});

test('a stalled cancellation cannot delay an early HTTP result indefinitely', async () => {
	let cancelStarted = false;
	const response = new Response(new ReadableStream<Uint8Array>({
		cancel() {
			cancelStarted = true;
			return new Promise<void>(() => {});
		},
	}));
	const result = await Effect.runPromise(
		Effect.gen(function*() {
			yield* scopedResponse(Effect.succeed(response));
			return yield* Effect.fail('primary failure');
		}).pipe(Effect.scoped, Effect.result, Effect.timeout('2 seconds')),
	);
	expect(result).toEqual(Result.fail('primary failure'));
	expect(cancelStarted).toBe(true);
	expect(response.body?.locked).toBe(false);
});

test('reader interruption releases its lock even when cancellation never settles', async () => {
	await Effect.runPromise(Effect.gen(function*() {
		const started = yield* Deferred.make<void>();
		let cancelStarted = false;
		const response = new Response(new ReadableStream<Uint8Array>(
			{
				pull() {
					Deferred.doneUnsafe(started, Exit.void);
				},
				cancel() {
					cancelStarted = true;
					return new Promise<void>(() => {});
				},
			},
			{ highWaterMark: 0 },
		));
		const fiber = yield* Effect.forkChild(
			Effect.gen(function*() {
				return yield* responseJson(yield* scopedResponse(Effect.succeed(response)));
			}).pipe(Effect.scoped),
		);
		yield* Deferred.await(started);
		yield* Fiber.interrupt(fiber).pipe(Effect.timeout('2 seconds'));
		expect(cancelStarted).toBe(true);
		expect(response.body?.locked).toBe(false);
	}));
});

test('cancellation rejection after the cleanup deadline is still handled', async () => {
	let rejectCancellation: ((reason: Error) => void) | undefined;
	const response = new Response(new ReadableStream<Uint8Array>({
		cancel() {
			return new Promise<void>((_resolve, reject) => {
				rejectCancellation = reject;
			});
		},
	}));
	const result = await Effect.runPromise(
		Effect.gen(function*() {
			yield* scopedResponse(Effect.succeed(response));
			return 'primary result';
		}).pipe(Effect.scoped, Effect.timeout('2 seconds')),
	);
	expect(result).toBe('primary result');
	if (!rejectCancellation) throw new Error('Cancellation did not start');
	rejectCancellation(new Error('late cancellation rejection'));
	await Promise.resolve();
	await Promise.resolve();
});

test('intermediate GitHub server errors cancel without reading and attempts reset per evaluation', async () => {
	let requests = 0, cancelled = 0, reads = 0;
	const work = gitHubRequest(
		async () => {
			requests++;
			if (requests % 3 === 0) return Response.json({ message: 'final server detail' }, { status: 503 });
			return new Response(
				new ReadableStream<Uint8Array>(
					{
						pull() {
							reads++;
						},
						cancel() {
							cancelled++;
						},
					},
					{ highWaterMark: 0 },
				),
				{ status: 503 },
			);
		},
		'/repos/o/r',
		'',
	);
	for (let evaluation = 1; evaluation <= 2; evaluation++) {
		const result = await Effect.runPromise(work.pipe(Effect.result, Effect.timeout('2500 millis')));
		expect(Result.isFailure(result) && result.failure.message).toContain('final server detail');
		expect(requests).toBe(3 * evaluation);
		expect(cancelled).toBe(2 * evaluation);
		expect(reads).toBe(0);
	}
});

test('GitHub diagnostics stop after a bounded prefix of a streaming error body', async () => {
	let reads = 0, cancelled = false;
	const result = await Effect.runPromise(
		gitHubRequest(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>(
						{
							pull(controller) {
								reads++;
								controller.enqueue(new TextEncoder().encode('x'.repeat(16_384)));
							},
							cancel() {
								cancelled = true;
							},
						},
						{ highWaterMark: 0 },
					),
					{ status: 400 },
				),
			'/repos/o/r',
			'',
		).pipe(Effect.result),
	);
	expect(Result.isFailure(result) && result.failure.message).toContain('x'.repeat(200));
	expect(reads).toBe(1);
	expect(cancelled).toBe(true);
});

test('GitHub error diagnostics time out while preserving the HTTP error', async () => {
	let cancelled = false;
	const result = await Effect.runPromise(
		gitHubRequest(
			async () => openResponse(400, () => {
				cancelled = true;
			}),
			'/repos/o/r',
			'',
		).pipe(Effect.result, Effect.timeout('3 seconds')),
	);
	expect(Result.isFailure(result) && result.failure.message).toBe('GitHub HTTP 400 on GET /repos/o/r');
	expect(cancelled).toBe(true);
});
