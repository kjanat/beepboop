import { expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { identityToken } from '@root/actions/runtime/session';
import { tokenRequest } from '@root/test/support/actions';
import { withEnvironment } from '@root/test/support/process';
import type { World } from '@root/test/support/world';
import { adminSubject, eachWorld, issuer, origin } from '@root/test/support/world';
import { experimental_AstroContainer } from 'astro/container';
import { createContext } from 'astro/middleware';
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Result, Schema } from 'effect';
import { applyVersionFiles } from '@/automation/editors';
import { RepositoryGateway } from '@/automation/github';
import { goManager } from '@/automation/managers/go';
import { yamlData, yamlDocument } from '@/automation/managers/helpers';
import { jsrManager, setUpJsrPackage } from '@/automation/managers/jsr';
import { pypiManager } from '@/automation/managers/pypi';
import type { Fetcher, Manager } from '@/automation/managers/registry';
import { registryLayer } from '@/automation/managers/registry';
import { verifyRegistry } from '@/automation/managers/verification';
import { vscodeManager } from '@/automation/managers/vscode';
import { verifyImage } from '@/automation/oci';
import type { Publication } from '@/automation/types';
import { Client } from '@/cli/client';
import { fromSync, recover } from '@/failure';
import { onRequest } from '@/middleware';
import { responseBytes } from '@/runtime/http';
import { decodeSync, mutableStruct } from '@/schema';
import { loaders } from '@/server/loaders';
import { temporaryDirectory } from '@/tooling/runtime';

let world: World;
eachWorld(created => {
	world = created;
});

function publication(manager: Publication['manager'], name: string): Publication {
	return { id: name, manager, name, version: '1.0.0', outcome: 'pending', required: true };
}
function verify(manager: Manager, name: string, request: Fetcher) {
	if (!manager.verifyPublication) throw new Error(`Missing verifier for ${manager.name}`);
	return manager.verifyPublication(publication(manager.name, name), request);
}
async function interruptBody(use: (response: Response) => Effect.Effect<unknown, unknown>) {
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
		const response = new Response(stream, { headers: { 'Content-Type': 'application/json' } });
		const fiber = yield* Effect.forkChild(use(response));
		yield* Deferred.await(started);
		yield* Fiber.interrupt(fiber);
		expect(cancelled).toBe(true);
		expect(stream.locked).toBe(false);
	}));
}

for (
	const [manager, name] of [
		[pypiManager, 'widget'],
		[goManager, 'example.com/widget'],
		[vscodeManager, 'octo.widget'],
		[jsrManager, '@octo/widget'],
	] as const
) {
	test(`${manager.name} publication reads cancel and unlock on interruption`, async () => {
		await interruptBody(response => verify(manager, name, () => Promise.resolve(response)));
	});
}

test('JSR version bytes and npm channel reads cancel and unlock on interruption', async () => {
	await interruptBody(response => verify(jsrManager, '@octo/widget', input =>
		Promise.resolve(
			String(input).endsWith('/meta.json')
				? Response.json({ scope: 'octo', name: 'widget', versions: { '1.0.0': {} } })
				: response,
		))
	);
	await interruptBody(response =>
		verifyRegistry(
			{ ...publication('npm', 'widget'), channel: 'latest' },
			input => Promise.resolve(String(input).endsWith('/tags') ? response : Response.json({})),
			'https://registry.test/widget',
			() => ({ name: 'widget', version: '1.0.0', digest: 'digest' }),
			'https://registry.test/tags',
		)
	);
});

test('JSR setup reads cancel on both success and error responses', async () => {
	for (const status of [200, 500]) {
		await interruptBody(response =>
			setUpJsrPackage('@octo/widget', 'octo/widget', 'token').pipe(
				Effect.provide(registryLayer(() => Promise.resolve(new Response(response.body, { status })))),
			)
		);
	}
});

test('OCI authentication, manifest bytes, and GitHub release downloads cancel and unlock', async () => {
	const image = { ...publication('npm', 'ghcr.io/octo/widget'), digest: `sha256:${'a'.repeat(64)}` };
	await interruptBody(response => verifyImage(image, input =>
		Promise.resolve(
			String(input).includes('/token') ? response : new Response(null, { status: 401 }),
		))
	);
	await interruptBody(response => {
		response.headers.set('docker-content-digest', image.digest);
		return verifyImage(image, () => Promise.resolve(response));
	});
	await interruptBody(response =>
		new RepositoryGateway(world.env, Number(world.env.OWNER_ID), () => Promise.resolve(response))
			.copyReleaseAsset('octo/widget', { id: 1, name: 'asset.zip', contentType: 'application/zip' }, 1, 'token')
	);
});

test('the binary reader preserves chunk bytes and releases its lock on success and failure', async () => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(Uint8Array.from([0, 255]));
			controller.enqueue(Uint8Array.from([128, 1]));
			controller.close();
		},
	});
	expect([...await Effect.runPromise(responseBytes(new Response(stream)))]).toEqual([0, 255, 128, 1]);
	expect(stream.locked).toBe(false);
	const broken = new ReadableStream<Uint8Array>({
		pull(controller) {
			controller.error(new Error('connection lost'));
		},
	});
	const result = await Effect.runPromise(responseBytes(new Response(broken)).pipe(Effect.result));
	expect(Result.isFailure(result) && result.failure.cause instanceof Error).toBe(true);
	expect(broken.locked).toBe(false);
});

test('invalid JSR version JSON remains a typed verification failure', async () => {
	const result = await Effect.runPromise(verify(jsrManager, '@octo/widget', input =>
		Promise.resolve(
			String(input).endsWith('/meta.json')
				? Response.json({ scope: 'octo', name: 'widget', versions: { '1.0.0': {} } })
				: new Response('{'),
		)));
	expect(result.outcome).toBe('uncertain');
});

test('Action identity, CLI status, and CLI login response reads cancel and unlock', async () => {
	await withEnvironment(tokenRequest, () => interruptBody(response => {
		spyOn(globalThis, 'fetch').mockImplementation(
			Object.assign(() => Promise.resolve(response), { preconnect: fetch.preconnect }),
		);
		return identityToken(new URL(origin));
	}));
	await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
		const directory = yield* temporaryDirectory('beepboop-cancel-client-');
		const client = yield* Client.at(origin, directory);
		const token = yield* Effect.promise(() => world.cliSession());
		yield* client.save({ token });
		for (const work of [client.status(), client.login(() => Effect.void)]) {
			yield* Effect.promise(() => interruptBody(response => {
				spyOn(globalThis, 'fetch').mockImplementation(
					Object.assign(() => Promise.resolve(response), { preconnect: fetch.preconnect }),
				);
				return work;
			}));
		}
	})));
});

test('the incoming CLI token body is cancelled when its request is aborted', async () => {
	await interruptBody(response => {
		const request = new Request(`${origin}/auth/cli/token`, { method: 'POST', body: response.body });
		return Effect.flatMap(
			Effect.promise(() => import('@/server/endpoint')),
			({ handleRequest }) => handleRequest(request),
		)
			.pipe(Effect.provide(world.application));
	});
});

test('invalid YAML inputs remain recoverable before and after an edit', async () => {
	const valid = 'version: "1.0.0"\n';
	const excessive =
		`${valid}a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n`;
	for (const malformed of [`${valid}other: *missing\n`, 'version: [\n', excessive]) {
		for (const [original, current] of [[malformed, malformed], [valid, malformed]] as const) {
			const files = { 'version.yml': current };
			const result = await Effect.runPromise(
				applyVersionFiles(
					{
						repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
						sha: 'a'.repeat(40),
						files: { 'version.yml': original },
						paths: ['version.yml'],
					},
					files,
					[{ path: 'version.yml', format: 'yaml', key: ['version'], template: '{version}' }],
					{ release: '1.1.0' },
				).pipe(recover(error => Effect.succeed(error.problem.code))),
			);
			expect(result).toBe('precondition');
			expect(files['version.yml']).toBe(current);
		}
	}
});

test('YAML conversion preserves unexpected programming defects', async () => {
	for (const bug of [new TypeError('decoder bug'), new ReferenceError('unexpected missing reference')]) {
		const document = yamlDocument('version: "1.0.0"');
		spyOn(document, 'toJS').mockImplementation(() => {
			throw bug;
		});
		const result = await Effect.runPromiseExit(fromSync(() => yamlData(document)).pipe(recover(() => Effect.void)));
		expect(Exit.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
	}
});

test('aborting dashboard authentication aborts JWKS retrieval and prevents rendering', async () => {
	const cookie = await world.adminCookie();
	const started = Promise.withResolvers<void>();
	let signal: AbortSignal | undefined;
	world.network.serve(new URL(issuer).host, request => {
		signal = request.signal;
		started.resolve();
		return new Promise<Response>((_resolve, reject) =>
			request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
		);
	});
	const controller = new AbortController();
	const request = new Request(origin, { headers: { Cookie: cookie }, signal: controller.signal });
	let rendered = false;
	const pending = Promise.resolve(
		onRequest(createContext({ request, params: {}, locals: {}, defaultLocale: 'en' }), async () => {
			rendered = true;
			return new Response('page');
		}),
	);
	const result = pending.catch((error: unknown) => error);
	await started.promise;
	controller.abort();
	expect(await result).toBeInstanceOf(Error);
	expect(signal?.aborted).toBe(true);
	expect(rendered).toBe(false);
});

test('aborting a rendered dashboard interrupts its loader and runs its finalizer', async () => {
	const started = Promise.withResolvers<void>();
	let finalized = false;
	spyOn(loaders, 'overview').mockImplementation(() =>
		Effect.sync(() => started.resolve()).pipe(
			Effect.andThen(Effect.never),
			Effect.ensuring(Effect.sync(() => {
				finalized = true;
			})),
		)
	);
	type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
	const module = mutableStruct({
		default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
	});
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Workspace.astro'));
	const container = await experimental_AstroContainer.create();
	const controller = new AbortController();
	const pending = container.renderToString(decodeSync(module, loaded).default, {
		props: { section: 'overview' },
		request: new Request(origin, { signal: controller.signal }),
		locals: { actor: adminSubject },
	});
	const result = pending.catch((error: unknown) => error);
	await started.promise;
	controller.abort();
	expect(await result).toBeInstanceOf(Error);
	expect(finalized).toBe(true);
});
