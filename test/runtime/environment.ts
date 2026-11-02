import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Response as RuntimeResponse } from 'miniflare';

async function buildProbe(): Promise<string> {
	const result = await Bun.build({
		entrypoints: ['test/runtime/probe.ts'],
		target: 'browser',
		format: 'esm',
		external: ['cloudflare:*'],
		plugins: [{
			name: 'built-worker',
			setup(build) {
				build.onResolve({ filter: /^@\/index$/ }, () => ({ path: './entry.mjs', external: true }));
			},
		}],
	});
	if (!result.success) throw new AggregateError(result.logs, 'Runtime probe build failed');
	const output = result.outputs[0];
	if (!output) throw Error('Missing runtime probe build');
	return output.text();
}

export async function createRuntime() {
	const moduleNames = (await readdir('.dry-run', { recursive: true })).filter(name => name.endsWith('.mjs'));
	const modules = Object.fromEntries(
		await Promise.all(
			moduleNames.map(
				async name => [name, { type: 'esm' as const, contents: await readFile(`.dry-run/${name}`, 'utf8') }],
			),
		),
	);
	const { privateKey, publicKey } = await generateKeyPair('ES256');
	const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' }] };
	const access = await new SignJWT({ mode: 'access', type: 'user', properties: {} })
		.setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).setIssuer('https://auth.test')
		.setAudience('fixture').setSubject('user:fixture').setExpirationTime('10m').sign(privateKey);
	const migration = (await Promise.all(
		(await readdir('migrations')).filter(name => name.endsWith('.sql')).sort().map(name =>
			readFile(`migrations/${name}`, 'utf8')
		),
	)).join('\n');
	const probeCode = await buildProbe();
	const directory = await mkdtemp(join(tmpdir(), 'release-automation-'));
	const network = { outbound: 0, allowExchange: false };
	function runtime() {
		return new Miniflare({
			resourcePersistencePath: directory,
			telemetry: { enabled: false },
			workers: [
				{
					config: {
						name: 'automation-test',
						compatibilityDate: '2026-10-20',
						compatibilityFlags: ['nodejs_compat'],
						assets: { directory: 'dist/client', hasUserWorker: true },
						manifest: {
							mainModule: 'probe.js',
							modules: {
								...modules,
								'probe.js': {
									type: 'esm',
									contents: probeCode,
								},
							},
						},
						exports: { Probe: { type: 'durable-object', storage: 'sqlite' } },
						env: {
							MIGRATIONS: { type: 'text', value: migration },
							AUTOMATION: { type: 'durable-object', worker: 'automation-test', exportName: 'Probe' },
							ASSETS: { type: 'assets' },
							DB: { type: 'd1', name: 'automation-test', id: '00000000-0000-0000-0000-000000000001' },
							OWNER_ID: { type: 'text', value: '1' },
							APPLICATION_ORIGIN: { type: 'text', value: 'https://automation.test' },
							OPENAUTH_ISSUER: { type: 'text', value: 'https://auth.test' },
							OPENAUTH_CLIENT_ID: { type: 'text', value: 'fixture' },
							ADMIN_SUBJECT: { type: 'text', value: 'user:fixture' },
							GITHUB_WEBHOOK_SECRET: { type: 'text', value: 'fixture-secret' },
						},
					},
					dev: {
						outboundService: {
							type: 'fetcher',
							handler: request => {
								if (request.url === 'https://auth.test/.well-known/jwks.json') return RuntimeResponse.json(jwks);
								if (network.allowExchange && request.url === 'https://auth.test/token') {
									return RuntimeResponse.json({
										access_token: access,
										refresh_token: 'fixture-refresh',
										expires_in: 600,
									});
								}
								network.outbound++;
								return new RuntimeResponse('Network disabled', { status: 503 });
							},
						},
					},
				},
			],
		});
	}

	let instance = runtime();
	// Exercise workerd over its local HTTP listener using Bun's native fetch.
	async function request(input: string, init?: RequestInit): Promise<Response> {
		const source = new URL(input);
		const local = new URL(source.pathname + source.search, await instance.ready);
		return fetch(local, { ...init, redirect: 'manual' });
	}
	try {
		const response = await request('https://automation.test/init');
		if (response.status !== 200) throw Error('Runtime database initialization failed');
	} catch (error) {
		await instance.dispose();
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
	return {
		fetch: request,
		access,
		network,
		async restart() {
			await instance.dispose();
			instance = runtime();
		},
		async close() {
			await instance.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
