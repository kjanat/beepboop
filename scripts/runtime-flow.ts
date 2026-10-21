import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { array, integer, record, text } from '../src/model.ts';

// Exercise the shipped Worker, real SQLite journal and HTTP adapter together.
// Only GitHub/PyPI responses are fixtures; no credentials or remote writes.
const directory = await mkdtemp(join(tmpdir(), 'beepboop-flow-'));
const bundle = await readFile(resolve('.dry-run/index.js'), 'utf8');
const keys = await generateKeyPair('RS256', { extractable: true });
const secret = 'runtime-flow-secret';
const ownerId = 6353477;
const source = { id: 1326162482, name: 'kjanat/actionlint' };
const destinations = [
	{ id: 1357905513, name: 'kjanat/scoop-bucket', route: 'actionlint-scoop' },
	{ id: 1358284523, name: 'kjanat/homebrew-tap', route: 'actionlint-homebrew' },
	{ id: 1427230928, name: 'kjanat/actionlint-pre-commit', route: 'actionlint-pre-commit' },
];
const releaseId = 44;
const sourceSha = 'a'.repeat(40);
const tagSha = 'b'.repeat(40);
const publication = {
	id: releaseId,
	tag_name: 'v2.0.0',
	draft: false,
	prerelease: false,
	published_at: new Date().toISOString(),
	assets: ['release-candidate.json', 'actionlint-scoop.json', 'actionlint-homebrew.rb'].map(
		(name, index) => ({
			id: 50 + index,
			name,
			size: 100,
			digest: `sha256:${'c'.repeat(64)}`,
		}),
	),
};
let ready = false;
let complete = false;
const dispatches = new Map<number, string>();
const failures: string[] = [];
async function github(request: Request): Promise<Response> {
	const url = new URL(request.url);
	if (url.href === 'https://pypi.org/pypi/actionlint-kjanat/2.0.0/json') {
		assert.equal(request.headers.get('authorization'), null);
		return Response.json({ info: { version: '2.0.0' }, urls: [{ filename: 'fixture.whl' }] });
	}
	assert.equal(url.origin, 'https://api.github.com');
	const authorization = request.headers.get('authorization');
	assert.ok(authorization);
	const bearer = authorization.replace(/^Bearer /, '');
	if (url.pathname.endsWith('/installation') || url.pathname.endsWith('/access_tokens')) {
		await jwtVerify(bearer, keys.publicKey, { issuer: '1234', algorithms: ['RS256'] });
		if (url.pathname.endsWith('/installation')) {
			return Response.json({ id: 777, account: { id: ownerId } });
		}
		assert.equal(request.method, 'POST');
		const body = record(await request.json());
		const ids = array(body.repository_ids);
		assert.equal(ids.length, 1);
		const id = integer(ids[0]);
		const permissions = record(body.permissions);
		assert.ok([source, ...destinations].some((repository) => repository.id === id));
		assert.equal(permissions.contents, 'read');
		assert.ok(['read', 'write'].includes(text(permissions.actions)));
		if (id === source.id) assert.equal(permissions.actions, 'read');
		return Response.json({ token: `${id}:${permissions.actions}` });
	}
	const repository = [source, ...destinations].find(
		(item) => url.pathname === `/repos/${item.name}` || url.pathname.startsWith(`/repos/${item.name}/`),
	);
	assert.ok(repository, `Unexpected repository: ${url.pathname}`);
	assert.ok(bearer.startsWith(`${repository.id}:`), 'Token crossed repository boundary');
	const path = url.pathname.slice(`/repos/${repository.name}`.length);
	if (path === '') {
		return Response.json({ id: repository.id, full_name: repository.name, owner: { id: ownerId } });
	}
	if (path === '/releases') return Response.json([publication]);
	if (path === `/releases/${releaseId}`) return Response.json(publication);
	if (path === '/git/ref/tags/v2.0.0') {
		return Response.json({ object: { type: 'tag', sha: tagSha } });
	}
	if (path === `/git/tags/${tagSha}`) {
		return Response.json({
			tag: 'v2.0.0',
			verification: { verified: true },
			object: { type: 'commit', sha: sourceSha },
		});
	}
	if (path === '/actions/workflows/release.yml/runs') {
		return Response.json({
			workflow_runs: [
				{
					id: 123,
					status: 'in_progress',
					conclusion: null,
					display_title: 'Release',
					head_sha: sourceSha,
					head_branch: 'v2.0.0',
					event: 'release',
					path: '.github/workflows/release.yml',
					repository: { id: source.id },
				},
			],
		});
	}
	if (path === '/actions/runs/123/jobs') {
		return Response.json({
			jobs: [
				'Verify published candidate',
				'Publish tested container bytes',
				'Publish PyPI wheels / Publish to PyPI',
			].map((name) => ({
				name,
				status: ready ? 'completed' : 'in_progress',
				conclusion: ready ? 'success' : null,
			})),
		});
	}
	const destination = destinations.find((item) => item.id === repository.id);
	assert.ok(destination, `Unexpected source endpoint: ${path}`);
	if (path === '/actions/workflows/release.yml/dispatches') {
		assert.equal(bearer, `${destination.id}:write`);
		assert.equal(request.method, 'POST');
		const operation = `${source.id}:${releaseId}:${destination.route}`;
		assert.deepEqual(await request.json(), {
			ref: 'master',
			inputs: {
				source_repository_id: String(source.id),
				release_id: String(releaseId),
				source_sha: sourceSha,
				operation_id: operation,
				dry_run: false,
			},
		});
		assert.equal(dispatches.has(destination.id), false, 'Duplicate publication dispatch');
		dispatches.set(destination.id, operation);
		return Response.json({ workflow_run_id: destination.id });
	}
	if (path === `/actions/runs/${destination.id}`) {
		return Response.json({
			id: destination.id,
			status: complete ? 'completed' : 'in_progress',
			conclusion: complete ? 'success' : null,
			display_title: `Beepboop ${dispatches.get(destination.id)}`,
			head_sha: 'd'.repeat(40),
			head_branch: 'master',
			event: 'workflow_dispatch',
			path: '.github/workflows/release.yml',
			repository: { id: destination.id },
		});
	}
	throw new Error(`Unexpected endpoint: ${url.href}`);
}
function runtime(pem: string): Miniflare {
	return new Miniflare({
		resourcePersistencePath: directory,
		telemetry: { enabled: false },
		workers: [
			{
				config: {
					name: 'beepboop-flow',
					compatibilityDate: '2026-10-20',
					manifest: {
						mainModule: 'probe.js',
						modules: {
							'probe.js': {
								type: 'esm',
								contents: `
import worker, { ReleaseCoordinator } from "./index.js";
export class Probe extends ReleaseCoordinator {
  async tick() {
    for (const operation of await this.all()) await this.put({...operation, nextAttempt: 0});
    await this.reconcile();
    await this.ctx.storage.deleteAlarm();
    return await this.status();
  }
}
export default { async fetch(request, env) {
  if (new URL(request.url).pathname === "/tick")
    return Response.json(await env.COORDINATOR.getByName("account").tick());
  return worker.fetch(request, env);
}};
`,
							},
							'index.js': { type: 'esm', contents: bundle },
						},
					},
					exports: { Probe: { type: 'durable-object', storage: 'sqlite' } },
					env: {
						COORDINATOR: { type: 'durable-object', worker: 'beepboop-flow', exportName: 'Probe' },
						GITHUB_APP_ID: { type: 'text', value: '1234' },
						GITHUB_APP_PRIVATE_KEY: { type: 'text', value: pem },
						GITHUB_WEBHOOK_SECRET: { type: 'text', value: secret },
					},
				},
				dev: {
					outboundService: {
						type: 'fetcher',
						handler: async (request: Request) => {
							try {
								return await github(request);
							} catch (error) {
								failures.push(String(error));
								return new Response('Fixture rejected request', { status: 500 });
							}
						},
					},
				},
			},
		],
	});
}
let instance: Miniflare | undefined;
try {
	const pem = await exportPKCS8(keys.privateKey);
	instance = runtime(pem);
	const health = await instance.dispatchFetch('https://beepboop.test/health');
	assert.deepEqual(await health.json(), { service: 'beepboop', enabled: true });
	const body = JSON.stringify({
		action: 'published',
		repository: { id: source.id, full_name: source.name, owner: { id: ownerId } },
	});
	const headers = {
		'x-github-event': 'release',
		'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
	};
	assert.equal(
		(
			await instance.dispatchFetch('https://beepboop.test/webhooks/github', {
				method: 'POST',
				body,
				headers,
			})
		).status,
		202,
	);
	async function tick(state: string): Promise<void> {
		assert.ok(instance);
		const response = await instance.dispatchFetch('https://beepboop.test/tick');
		const value = record(await response.json());
		assert.deepEqual(failures, []);
		assert.equal(array(value.operations).length, 3);
		assert.equal(array(value.discovery).length, 3);
		assert.ok(array(value.discovery).every((item) => record(item).healthy === true));
		assert.ok(array(value.operations).every((item) => record(item).state === state));
	}
	await tick('waiting');
	assert.equal(dispatches.size, 0);
	ready = true;
	await tick('dispatched');
	assert.equal(dispatches.size, 3);
	await instance.dispose();
	instance = runtime(pem);
	await tick('dispatched');
	complete = true;
	await tick('succeeded');
	// Redelivery after success must not produce another downstream run.
	await instance.dispatchFetch('https://beepboop.test/webhooks/github', {
		method: 'POST',
		body,
		headers,
	});
	await tick('succeeded');
	assert.equal(dispatches.size, 3);
	console.log(
		'Signed webhook -> readiness -> three dispatches -> restart -> completion -> replay passed',
	);
} finally {
	await instance?.dispose();
	await rm(directory, { recursive: true, force: true });
}
