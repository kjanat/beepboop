import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Response as RuntimeResponse } from 'miniflare';

const directory = await mkdtemp(join(tmpdir(), 'release-automation-'));
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
const fixture = {
	id: 'fixture-execution',
	repositoryId: 91,
	repository: 'example/seventh',
	stream: 'main',
	operation: 'promote',
	eventId: 'fixture',
	configuration: {
		extends: [],
		managers: ['workflow'],
		subscriptions: [],
		streams: {
			main: {
				versioning: 'none',
				prepare: { version: 'manual' },
				promote: { approval: 'required' },
				workflows: {},
				required: [],
				credentials: [],
				channels: { stable: 'latest', prerelease: 'next' },
				concurrency: 'queue',
			},
		},
	},
	configurationSha: 'a'.repeat(40),
	presetShas: {},
	sourceSha: 'b'.repeat(40),
	state: 'blocked',
	dependencies: [],
	workflow: { file: 'release.yml', ref: 'main' },
	attempts: 0,
	publications: [],
	artifacts: [],
	createdAt: 1,
	updatedAt: 1,
};
let outbound = 0;
let allowExchange = false;
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
								contents: `
import worker,{AutomationCoordinator} from './entry.mjs';
export class Probe extends AutomationCoordinator {
 gateway(){return {
  token:async()=> 'fixture-token',
  call:async path=>{
   if(path.includes('/check-runs'))return {total_count:1,check_runs:[{status:'completed',conclusion:this.invalidCheck?'failure':'success'}]};
   if(path.endsWith('/status'))return {total_count:0};
   if(path.includes('/commits/'))return {commit:{verification:{verified:!this.invalidSignature}}};
   throw new Error('Unexpected fixture gateway path');
  },
  snapshot:async()=>({repository:{id:91,name:'example/seventh',defaultBranch:'main'},sha:'b'.repeat(40),files:{}}),
  preparedSnapshot:async()=>({repository:{id:91,name:'example/seventh',defaultBranch:'main'},sha:'d'.repeat(40),files:{'package.json':'{"name":"tool","version":"2.0.0"}', '.github/workflows/release.yml':'on: {workflow_dispatch: {inputs: {beepboop_execution_id: {type: string}}}}'}}),
  pullRequest:async(...args)=>{await args[6]('c'.repeat(40));throw new Error('Fixture interruption after checkpoint');},
  resumePreparation:async(_snapshot,_branch,_title,_body,head)=>({head,url:'https://github.com/example/seventh/pull/1'})
 };}
 async fetch(request){const path=new URL(request.url).pathname;
 if(path==='/enqueue')return Response.json(await this.enqueue(await request.json()));
 if(path==='/events')return Response.json(await this.releaseEvents());
 if(path==='/approve-probe'){const url=new URL(request.url);this.invalidSignature=url.searchParams.has('unsigned');this.invalidCheck=url.searchParams.has('failed');try{return Response.json(await this.approve('fixture-execution','b'.repeat(40),'fixture'));}catch(error){return Response.json({error:error.message},{status:400});}}
 if(path==='/register-probe'){try{return Response.json(await this.register('fixture-execution',{runId:12,repositoryId:91,repository:'example/seventh'}));}catch(error){return Response.json({error:error.message},{status:400});}}
 if(path==='/start-set')return Response.json(await this.startReleaseSet('set-prep','d'.repeat(40)));
 if(path==='/prepared-probe')return Response.json(await this.prepared('workflow-prep',{repositoryId:91,runId:10,attempt:1,workflowSha:'a'.repeat(40)},[{path:'version.txt',before:'1',after:'2'}]));
 if(path==='/tick-managed'){await this.alarm();return Response.json(await this.ctx.storage.get('execution:managed-fixture'));}
 return Response.json(await this.ctx.storage.get('execution:fixture-execution'));
 }}
export default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path==='/init'){for(const sql of ${
									JSON.stringify(
										migration,
									)
								}.split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();return new Response('ready')}
if(path==='/index')return Response.json(await env.DB.prepare('SELECT document FROM executions').all());
if(path==='/enqueue'||path==='/journal'||path==='/events'||path==='/tick-managed'||path==='/start-set'||path==='/prepared-probe'||path==='/approve-probe'||path==='/register-probe')return env.AUTOMATION.getByName('91').fetch(request);
return worker.fetch(request,env,ctx)}};
`,
							},
						},
					},
					exports: { Probe: { type: 'durable-object', storage: 'sqlite' } },
					env: {
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
							if (allowExchange && request.url === 'https://auth.test/token') {
								return RuntimeResponse.json({
									access_token: access,
									refresh_token: 'fixture-refresh',
									expires_in: 600,
								});
							}
							outbound++;
							return new RuntimeResponse('Network disabled', { status: 503 });
						},
					},
				},
			},
		],
	});
}
let instance: Miniflare | undefined;
try {
	instance = runtime();
	assert.equal((await instance.dispatchFetch('https://automation.test/init')).status, 200);
	assert.equal((await instance.dispatchFetch('https://automation.test/health')).status, 200);
	assert.equal(
		(await instance.dispatchFetch('https://automation.test/api/credentials')).status,
		401,
	);
	assert.equal(
		(
			await instance.dispatchFetch('https://automation.test/api/executions/start', {
				method: 'POST',
				body: '{}',
			})
		).status,
		401,
	);
	const response = await instance.dispatchFetch('https://automation.test/enqueue', {
		method: 'POST',
		body: JSON.stringify(fixture),
	});
	assert.equal(response.status, 200);
	const first = (await response.json()) as typeof fixture;
	assert.equal(first.sourceSha, fixture.sourceSha);
	const duplicate = await instance.dispatchFetch('https://automation.test/enqueue', {
		method: 'POST',
		body: JSON.stringify({ ...fixture, sourceSha: 'c'.repeat(40) }),
	});
	assert.equal(((await duplicate.json()) as typeof fixture).sourceSha, fixture.sourceSha);
	const body = JSON.stringify({
		action: 'published',
		repository: { id: 999, full_name: 'example/unrelated', owner: { id: 1 } },
	});
	const signature = createHmac('sha256', 'fixture-secret').update(body).digest('hex');
	const ignored = await instance.dispatchFetch('https://automation.test/webhooks/github', {
		method: 'POST',
		body,
		headers: { 'x-github-event': 'release', 'x-hub-signature-256': `sha256=${signature}` },
	});
	assert.equal(ignored.status, 204);
	assert.equal(outbound, 0);
	for (const path of ['/', '/repositories', '/releases', '/runs', '/secrets', '/activity', '/security']) {
		const page = await instance.dispatchFetch(`https://automation.test${path}`, {
			redirect: 'manual',
			headers: { cookie: `__Host-beepboop_access=${access}` },
		});
		assert.equal(page.status, 200, `Authenticated Astro page ${path}: ${await page.clone().text()}`);
		const html = await page.text();
		assert.match(html, /Beepboop/);
		assert.match(html, /<nav aria-label="Main navigation"/);
		assert.ok(page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
		assert.ok(page.headers.get('content-security-policy')?.includes("style-src 'self';"));
		assert.ok(!page.headers.get('content-security-policy')?.includes("'unsafe-inline'"));
	}
	const absent = await instance.dispatchFetch('https://automation.test/no-such-page');
	assert.equal(absent.status, 404);

	const cookieless = await instance.dispatchFetch('https://automation.test/auth/callback?code=c&state=s', {
		redirect: 'manual',
	});
	assert.equal(cookieless.status, 401);
	assert.match(await cookieless.text(), /Sign in again/);
	const stale = await instance.dispatchFetch('https://automation.test/auth/callback?code=c&state=s', {
		redirect: 'manual',
		headers: { cookie: '__Host-beepboop_flow=no-such-flow' },
	});
	assert.equal(stale.status, 302);
	assert.equal(stale.headers.get('location'), '/auth/login');
	const login = await instance.dispatchFetch('https://automation.test/auth/login', { redirect: 'manual' });
	assert.equal(login.status, 302);
	const flowId = /__Host-beepboop_flow=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
	const state = new URL(login.headers.get('location') ?? '').searchParams.get('state');
	assert.ok(flowId && state);
	const unreachable = await instance.dispatchFetch(
		`https://automation.test/auth/callback?code=c&state=${encodeURIComponent(state)}`,
		{ redirect: 'manual', headers: { cookie: `__Host-beepboop_flow=${flowId}` } },
	);
	assert.equal(unreachable.status, 401);
	assert.match(await unreachable.text(), /Login exchange failed/);
	const reusedLogin = await instance.dispatchFetch(
		`https://automation.test/auth/callback?code=c&state=${encodeURIComponent(state)}`,
		{ redirect: 'manual', headers: { cookie: `__Host-beepboop_flow=${flowId}` } },
	);
	assert.equal(reusedLogin.headers.get('location'), '/auth/login');
	allowExchange = true;
	const freshLogin = await instance.dispatchFetch('https://automation.test/auth/login', { redirect: 'manual' });
	const freshLocation = new URL(freshLogin.headers.get('location') ?? '');
	assert.equal(freshLocation.searchParams.get('redirect_uri'), 'https://automation.test/auth/callback');
	assert.equal(freshLocation.searchParams.get('code_challenge_method'), 'S256');
	const freshCookie = freshLogin.headers.get('set-cookie')?.split(';')[0];
	assert.ok(freshCookie);
	const callback = await instance.dispatchFetch(
		`https://automation.test/auth/callback?code=fixture&state=${freshLocation.searchParams.get('state')}`,
		{ redirect: 'manual', headers: { cookie: freshCookie } },
	);
	assert.equal(callback.status, 302, await callback.clone().text());
	const sessionCookie = callback.headers.get('set-cookie')?.split(';')[0];
	assert.ok(sessionCookie?.startsWith('__Host-beepboop_access='));
	const signedIn = await instance.dispatchFetch('https://automation.test/', {
		redirect: 'manual',
		headers: { cookie: sessionCookie },
	});
	assert.equal(signedIn.status, 200);
	assert.match(await signedIn.text(), /What needs to ship/);
	const released = {
		...fixture,
		id: 'completed-release',
		operation: 'publish',
		state: 'succeeded',
		version: '1.2.3',
		publications: [{
			id: 'npm:fixture',
			manager: 'npm',
			name: 'fixture',
			version: '1.2.3',
			outcome: 'succeeded',
			required: true,
		}],
		configuration: {
			...fixture.configuration,
			streams: { main: { ...fixture.configuration.streams.main, required: ['npm:fixture'] } },
		},
	};
	const completed = await instance.dispatchFetch('https://automation.test/enqueue', {
		method: 'POST',
		body: JSON.stringify(released),
	});
	assert.equal(completed.status, 200);
	const events = await (await instance.dispatchFetch('https://automation.test/events')).json() as {
		release: { commit: string; repository: { id: number }; version: string };
	}[];
	assert.equal(events.length, 1);
	assert.equal(events[0]?.release.commit, fixture.sourceSha);
	assert.equal(events[0]?.release.repository.id, fixture.repositoryId);
	assert.equal(events[0]?.release.version, '1.2.3');
	await instance.dispose();
	instance = runtime();
	const journal = await instance.dispatchFetch('https://automation.test/journal');
	assert.equal(((await journal.json()) as typeof fixture).sourceSha, fixture.sourceSha);
	const index = await instance.dispatchFetch('https://automation.test/index');
	const indexed = (await index.json()) as { results: { document: string }[] };
	assert.equal(indexed.results.length, 2);
	assert.ok(indexed.results.some(row => JSON.parse(row.document).state === 'blocked'));
	const durableEvents = await (await instance.dispatchFetch('https://automation.test/events')).json() as unknown[];
	assert.equal(durableEvents.length, 1);
	const managed = {
		...fixture,
		id: 'managed-fixture',
		operation: 'prepare',
		state: 'ready',
		workflow: undefined,
		managed: {
			kind: 'prepare',
			branch: 'release/main/fixture',
			title: 'prepare',
			body: 'fixture',
			plan: {
				sourceSha: fixture.sourceSha,
				requiresPreparation: false,
				edits: [{ path: 'version.txt', before: '1', after: '2' }],
			},
		},
	};
	await instance.dispatchFetch('https://automation.test/enqueue', { method: 'POST', body: JSON.stringify(managed) });
	const interrupted = await (await instance.dispatchFetch('https://automation.test/tick-managed')).json() as {
		state: string;
		managed: { head: string; result?: { head: string } };
	};
	assert.equal(interrupted.state, 'uncertain');
	assert.equal(interrupted.managed.head, 'c'.repeat(40));
	await instance.dispose();
	instance = runtime();
	const resumed = await (await instance.dispatchFetch('https://automation.test/tick-managed'))
		.json() as typeof interrupted;
	assert.equal(resumed.state, 'succeeded');
	assert.equal(resumed.managed.result?.head, interrupted.managed.head);
	const workflowPreparation = {
		...fixture,
		id: 'workflow-prep',
		operation: 'prepare',
		state: 'running',
		runId: 10,
		runAttempt: 1,
		workflowSha: 'a'.repeat(40),
		plan: { sourceSha: fixture.sourceSha, version: '2.0.0', edits: [{ path: 'version.txt', before: '1', after: '2' }] },
	};
	await instance.dispatchFetch('https://automation.test/enqueue', {
		method: 'POST',
		body: JSON.stringify(workflowPreparation),
	});
	const interruptedWorkflow = await instance.dispatchFetch('https://automation.test/prepared-probe');
	assert.equal(interruptedWorkflow.status, 500);
	await instance.dispose();
	instance = runtime();
	const resumedWorkflow = await (await instance.dispatchFetch('https://automation.test/prepared-probe')).json() as {
		head: string;
	};
	assert.equal(resumedWorkflow.head, 'c'.repeat(40));
	const setPreparation = {
		...managed,
		id: 'set-prep',
		state: 'succeeded',
		configuration: {
			...fixture.configuration,
			managers: ['workflow', 'npm'],
			streams: {
				main: {
					...fixture.configuration.streams.main,
					workflows: { build: { file: 'release.yml' }, publish: { file: 'release.yml', needs: ['build'] } },
				},
			},
		},
		managed: {
			...managed.managed,
			result: { url: 'https://github.com/example/seventh/pull/2', head: 'c'.repeat(40) },
			plan: {
				sourceSha: fixture.sourceSha,
				edits: [{ path: 'package.json', before: '{}', after: '{"name":"tool","version":"2.0.0"}' }],
				groups: [{ id: 'tool', version: '2.0.0', packages: ['npm:tool'] }],
				operations: ['build', 'publish'].map(id => ({
					id,
					group: 'tool',
					version: '2.0.0',
					inputs: [],
					outputs: [],
					needs: [],
				})),
			},
		},
	};
	await instance.dispatchFetch('https://automation.test/enqueue', {
		method: 'POST',
		body: JSON.stringify(setPreparation),
	});
	const started = await (await instance.dispatchFetch('https://automation.test/start-set')).json() as {
		id: string;
		version: string;
		dependencies: string[];
	}[];
	assert.equal(started.length, 2);
	assert.equal(started[0]?.version, '2.0.0');
	assert.deepEqual(started[1]?.dependencies, [started[0]?.id]);
	await instance.dispose();
	instance = runtime();
	const replayed = await (await instance.dispatchFetch('https://automation.test/start-set')).json() as typeof started;
	assert.deepEqual(replayed.map(execution => execution.id), started.map(execution => execution.id));
	const premature = await instance.dispatchFetch('https://automation.test/register-probe');
	assert.equal(premature.status, 400);
	assert.match((await premature.json() as { error: string }).error, /not been dispatched/);
	const unsigned = await instance.dispatchFetch('https://automation.test/approve-probe?unsigned=1');
	assert.equal(unsigned.status, 400);
	assert.match((await unsigned.json() as { error: string }).error, /signature/);
	const failedChecks = await instance.dispatchFetch('https://automation.test/approve-probe?failed=1');
	assert.equal(failedChecks.status, 400);
	assert.match((await failedChecks.json() as { error: string }).error, /checks/);
	const approved = await instance.dispatchFetch('https://automation.test/approve-probe');
	assert.equal(approved.status, 200);
	assert.equal((await approved.json() as { state: string }).state, 'ready');
	if (process.argv.includes('--browser')) {
		const db = await instance.getD1Database('DB', 'automation-test');
		const repository = {
			id: 91,
			name: 'example/seventh',
			defaultBranch: 'main',
			sha: 'a'.repeat(40),
			configuration: {
				...fixture.configuration,
				streams: {
					main: {
						...fixture.configuration.streams.main,
						credentials: ['npm-token'],
						workflows: { publish: { file: 'release.yml', ref: 'refs/heads/main' } },
					},
				},
			},
			presetShas: {},
			diagnostics: [],
			updatedAt: Date.now(),
			inventory: {
				packages: [{
					name: 'example-cli',
					manager: 'npm',
					version: '1.2.3',
					published: '1.2.2',
					manifest: 'package.json',
					versionSource: 'package.json',
					publish: true,
					dependencies: [],
				}],
				workflows: [{
					name: 'Release',
					file: 'release.yml',
					events: ['workflow_dispatch'],
					dispatchInputs: ['beepboop_execution_id'],
					jobs: [],
					localActions: [],
					publication: true,
				}],
				managers: ['npm'],
				diagnostics: [],
			},
		};
		await db.prepare('INSERT OR REPLACE INTO repositories VALUES(?,?,?,?)').bind(
			91,
			repository.name,
			JSON.stringify(repository),
			Date.now(),
		).run();
		await db.prepare('INSERT OR REPLACE INTO credentials VALUES(?,?,?,?,?,1,?)').bind(
			'npm-token',
			1,
			'fixture',
			'fixture',
			'fixture',
			Date.now(),
		).run();
		await db.prepare('INSERT OR REPLACE INTO authenticators VALUES(?,?,?)').bind(
			'fixture-key',
			'user:fixture',
			JSON.stringify({ id: 'fixture-key', label: 'Fixture key', publicKey: 'fixture', counter: 0 }),
		).run();
		const previewRuntime = instance;
		const server = createServer(async (request, response) => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const headers = new Headers();
				for (const [key, value] of Object.entries(request.headers)) {
					if (value && key !== 'host') headers.set(key, Array.isArray(value) ? value.join(',') : value);
				}
				headers.set('cookie', `__Host-beepboop_access=${access}`);
				if (headers.has('origin')) headers.set('origin', 'https://automation.test');
				const result = await previewRuntime.dispatchFetch(`https://automation.test${request.url}`, {
					method: request.method,
					headers: Object.fromEntries(headers),
					body: chunks.length ? Buffer.concat(chunks) : undefined,
					redirect: 'manual',
				});
				response.writeHead(result.status, Object.fromEntries(result.headers));
				response.end(Buffer.from(await result.arrayBuffer()));
			} catch {
				response.writeHead(500);
				response.end('Fixture request failed');
			}
		});
		await new Promise<void>(resolve => server.listen(4331, '127.0.0.1', resolve));
		console.log('Authenticated test fixture at http://127.0.0.1:4331 (isolated temporary database).');
		await new Promise<void>(resolve => {
			process.once('SIGINT', () => server.close(() => resolve()));
			process.once('SIGTERM', () => server.close(() => resolve()));
		});
	}
	console.log(
		'Automation Worker: authentication gates, unrelated event filtering, immutable enqueue, D1 indexing, Durable Object restart and managed and workflow preparation recovery release-set replay and promotion gates passed',
	);
} finally {
	await instance?.dispose();
	await rm(directory, { recursive: true, force: true });
}
