import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'beepboop-runtime-'));
const bundle = await readFile(resolve('.dry-run/index.js'), 'utf8');
const fixture = {
	id: '11:44:test',
	routeId: 'test',
	routeIdentity: 'fixture',
	release: {
		id: 44,
		tag: 'v2.0.0',
		sha: 'a'.repeat(40),
		publishedAt: '2026-10-20T00:00:00Z',
		assets: [],
	},
	state: 'waiting',
	reason: 'fixture',
	attempts: 0,
	updatedAt: 0,
	nextAttempt: 0,
};
function runtime(): Miniflare {
	return new Miniflare({
		resourcePersistencePath: directory,
		telemetry: { enabled: false },
		workers: [
			{
				config: {
					name: 'beepboop-test',
					compatibilityDate: '2026-10-20',
					manifest: {
						mainModule: 'probe.js',
						modules: {
							'probe.js': {
								type: 'esm',
								contents: `
        import worker, {ReleaseCoordinator} from "./index.js";
        export class Probe extends ReleaseCoordinator {
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/seed") { await this.put(await request.json()); await this.advance("test", "v2.0.0"); }
            if (path === "/wake") await this.wake();
            return Response.json({operations: await this.all(), version: await this.watermark("test"), alarm: await this.ctx.storage.getAlarm()});
          }
        }
        export default { async fetch(request, env) {
          if (new URL(request.url).pathname.startsWith("/probe/")) {
            const url = new URL(request.url); url.pathname = url.pathname.slice(6);
            return env.COORDINATOR.getByName("account").fetch(new Request(url, request));
          }
          return worker.fetch(request, env);
        }};
`,
							},
							'index.js': { type: 'esm', contents: bundle },
						},
					},
					exports: { Probe: { type: 'durable-object', storage: 'sqlite' } },
					env: {
						COORDINATOR: { type: 'durable-object', worker: 'beepboop-test', exportName: 'Probe' },
						GITHUB_WEBHOOK_SECRET: { type: 'text', value: 'runtime-test-secret' },
					},
				},
				dev: {
					outboundService: {
						type: 'fetcher',
						handler: () => new Response('Network disabled in runtime smoke test', { status: 503 }),
					},
				},
			},
		],
	});
}
let instance: Miniflare | undefined;
try {
	instance = runtime();
	const health = await instance.dispatchFetch('https://beepboop.test/health');
	assert.equal(health.status, 200);
	const dashboard = await instance.dispatchFetch('https://beepboop.test/');
	assert.equal(dashboard.status, 200);
	assert.match(await dashboard.text(), /Actup|actup/);
	const forged = await instance.dispatchFetch('https://beepboop.test/webhooks/github', {
		method: 'POST',
		body: '{}',
	});
	assert.equal(forged.status, 401);
	await instance.dispatchFetch('https://beepboop.test/probe/seed', {
		method: 'POST',
		body: JSON.stringify(fixture),
	});
	const before = await instance.dispatchFetch('https://beepboop.test/probe/read');
	assert.deepEqual(await before.json(), { operations: [fixture], version: 'v2.0.0', alarm: null });
	await instance.dispose();
	instance = runtime();
	const after = await instance.dispatchFetch('https://beepboop.test/probe/read');
	assert.deepEqual(await after.json(), { operations: [fixture], version: 'v2.0.0', alarm: null });
	const alarm = await instance.dispatchFetch('https://beepboop.test/probe/wake');
	const value: unknown = await alarm.json();
	assert.equal(typeof value, 'object');
	assert.ok(
		typeof value === 'object'
			&& value !== null
			&& 'alarm' in value
			&& typeof value.alarm === 'number',
	);
	console.log('Worker and SQLite Durable Object persistence smoke test passed');
} finally {
	await instance?.dispose();
	await rm(directory, { recursive: true, force: true });
}
