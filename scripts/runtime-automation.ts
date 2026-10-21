import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

const directory = await mkdtemp(join(tmpdir(), 'release-automation-'));
const bundle = await readFile('.dry-run/index.js', 'utf8');
const migration = await readFile('migrations/0001_automation.sql', 'utf8');
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
function runtime() {
	return new Miniflare({
		resourcePersistencePath: directory,
		telemetry: { enabled: false },
		workers: [
			{
				config: {
					name: 'automation-test',
					compatibilityDate: '2026-10-20',
					manifest: {
						mainModule: 'probe.js',
						modules: {
							'index.js': { type: 'esm', contents: bundle },
							'probe.js': {
								type: 'esm',
								contents: `
import worker,{AutomationCoordinator} from './index.js';
export class Probe extends AutomationCoordinator {async fetch(request){const path=new URL(request.url).pathname;if(path==='/enqueue')return Response.json(await this.enqueue(await request.json()));return Response.json(await this.ctx.storage.get('execution:fixture-execution'));}}
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path==='/init'){for(const sql of ${
									JSON.stringify(
										migration,
									)
								}.split(';').filter(s=>s.trim()))await env.DB.prepare(sql).run();return new Response('ready')}
if(path==='/index')return Response.json(await env.DB.prepare('SELECT document FROM executions').all());
if(path==='/enqueue'||path==='/journal')return env.AUTOMATION.getByName('91').fetch(request);
return worker.fetch(request,env)}};
`,
							},
						},
					},
					exports: { Probe: { type: 'durable-object', storage: 'sqlite' } },
					env: {
						AUTOMATION: { type: 'durable-object', worker: 'automation-test', exportName: 'Probe' },
						DB: { type: 'd1', name: 'automation-test', id: '00000000-0000-0000-0000-000000000001' },
						AUTOMATION_ENABLED: { type: 'text', value: 'true' },
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
						handler: () => {
							outbound++;
							return new Response('Network disabled', { status: 503 });
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
	await instance.dispose();
	instance = runtime();
	const journal = await instance.dispatchFetch('https://automation.test/journal');
	assert.equal(((await journal.json()) as typeof fixture).sourceSha, fixture.sourceSha);
	const index = await instance.dispatchFetch('https://automation.test/index');
	const indexed = (await index.json()) as { results: { document: string }[] };
	assert.equal(indexed.results.length, 1);
	assert.equal(JSON.parse(indexed.results[0]?.document ?? '{}').state, 'blocked');
	console.log(
		'Automation Worker: authentication gates, unrelated event filtering, immutable enqueue, D1 indexing and Durable Object restart passed',
	);
} finally {
	await instance?.dispose();
	await rm(directory, { recursive: true, force: true });
}
