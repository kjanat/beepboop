import { expect, test } from 'bun:test';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client.ts';
import { env as runtimeEnv } from '@root/test/support/cloudflare-workers.ts';
import { bearer, bearerRequest, reply } from '@root/test/support/http.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect, Fiber, Result } from 'effect';
import { TestClock } from 'effect/testing';
import { ApiFailure } from '@/contract/client';
import { errorEnvelope } from '@/contract/errors';
import { routeIds, routes } from '@/contract/routes';
import { rawRoutes, resolve } from '@/server/router';

const legacy = [
	'GET /health',
	'GET /schema/v1.json',
	'POST /webhooks/github',
	'GET /api/winget',
	'GET /api/repositories',
	'GET /api/executions',
	'GET /api/notifications',
	'GET /api/credentials',
	'POST /api/winget/refresh',
	'POST /api/winget/releases',
	'POST /api/winget/preview',
	'POST /api/winget/submit',
	'POST /api/repositories/discover',
	'POST /api/repositories/setup/preview',
	'POST /api/repositories/setup/apply',
	'POST /api/releases/update-references',
	'POST /api/releases/start-set',
	'POST /api/releases/plan-set',
	'POST /api/releases/prepare-set',
	'POST /api/releases/plan',
	'POST /api/releases/prepare',
	'POST /api/executions/approval',
	'POST /api/cli-sessions/revoke',
	'POST /api/cli-sessions/revoke-all',
	'POST /api/executions/cancel',
	'POST /api/executions/approve',
	'POST /api/executions/recover',
	'POST /api/authenticators/options',
	'POST /api/authenticators/verify',
	'POST /api/authenticators/remove',
	'POST /api/packages/add',
	'POST /api/packages/remove',
	'POST /api/packages/subscription',
	'POST /api/notifications/save',
	'POST /api/notifications/remove',
	'POST /api/credentials/replace',
	'POST /api/credentials/reveal',
	'POST /api/credentials/sync',
	'POST /api/credentials/grant',
	'POST /api/credentials/revoke',
	'POST /api/workflow/token',
	'POST /api/workflow/start',
	'POST /api/workflow/begin',
	'POST /api/workflow/prepared',
	'POST /api/workflow/report',
	'POST /api/workflow/credentials',
	'POST /api/workflow/refs-plan',
	'POST /api/workflow/refs-complete',
	'POST /api/workflow/release',
] as const;

let world: World;
eachWorld(created => {
	world = created;
});

async function refused(work: Promise<unknown>): Promise<ApiFailure> {
	try {
		await work;
	} catch (error) {
		if (error instanceof ApiFailure) return error;
		throw error;
	}
	throw new Error('Expected the server to refuse the request');
}

test('the route table answers every path the old router answered, and nothing else', async () => {
	const served = new Set([
		...routeIds.map(id => `${routes[id].method} ${routes[id].path}`),
		...[...rawRoutes].flatMap(([path, raw]) => raw.methods.map(method => `${method} ${path}`)),
	]);
	expect([...served].filter(entry => !legacy.some(old => old === entry))).toEqual([
		'POST /api/repositories/resolve',
		'GET /api/v1/changes',
		'POST /api/v1/admin/reindex',
		'POST /api/workflow/publish/next',
		'POST /api/workflow/publish/claim',
		'POST /api/workflow/publish/report',
	]);
	expect(legacy.filter(entry => !served.has(entry))).toEqual([]);
	for (const entry of legacy) {
		const [method = '', path = ''] = entry.split(' ');
		if (path.startsWith('/api/')) expect(resolve(method, path)).toBeDefined();
		const response = await world.handle(
			new Request(`${origin}${path}`, { method, body: method === 'GET' ? null : '{}' }),
		);
		expect({ entry, status: response.status }).not.toEqual({ entry, status: 404 });
		expect({ entry, status: response.status }).not.toEqual({ entry, status: 405 });
	}
	const unknown = await reply(await world.handle(new Request(`${origin}/api/repositories/nope`)));
	expect(unknown.status).toBe(404);
	expect(errorEnvelope.parse(unknown.body).problem).toEqual({ code: 'not-found', resource: 'route' });
	const suffixed = await world.handle(
		new Request(`${origin}/api/workflow/anything/begin`, { method: 'POST', body: '{}' }),
	);
	expect(suffixed.status).toBe(404);
	const wrongMethod = await reply(await world.handle(new Request(`${origin}/api/repositories`, { method: 'POST' })));
	expect(wrongMethod.status).toBe(405);
	expect(wrongMethod.headers.get('allow')).toBe('GET');
	expect(errorEnvelope.parse(wrongMethod.body).problem).toEqual({ code: 'method-not-allowed', allowed: ['GET'] });
	const anonymous = await reply(await world.handle(new Request(`${origin}/api/executions`)));
	expect(anonymous.status).toBe(401);
	expect(errorEnvelope.parse(anonymous.body).problem).toEqual({ code: 'unauthenticated' });
	expect(world.network.unrouted).toEqual([]);
});

test('contract calls round-trip through the server for a discovered repository', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const send = cliTransport(world, await world.cliSession());

	expect(await call(routes.repositoriesList, {}, send)).toEqual([]);
	const discovered = await call(routes.repositoriesDiscover, { repository: 'widget' }, send);
	expect(discovered.name).toBe('octo/widget');
	expect((await call(routes.repositoriesResolve, { repository: 'OCTO/Widget' }, send)).id).toBe(repository.id);
	expect((await call(routes.repositoriesList, {}, send)).map(entry => entry.name)).toEqual(['octo/widget']);
	expect(await call(routes.executionsList, {}, send)).toEqual([]);
	expect(await call(routes.credentialsList, {}, send)).toEqual({ credentials: [], grants: [], deliveries: [] });
	expect(await call(routes.notificationsList, {}, send)).toEqual({
		destinations: [],
		subscriptions: [],
		deliveries: [],
	});

	const plan = await call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: '1.1.0' }, send);
	expect(plan.version).toBe('1.1.0');
	const prepared = await call(
		routes.releasesPrepare,
		{ repositoryId: repository.id, stream: 'main', version: '1.1.0', sourceSha: plan.sourceSha, planId: plan.planId },
		send,
	);
	expect(prepared.state).toBe('ready');
	expect((await call(routes.executionsList, {}, send)).map(entry => entry.id)).toEqual([prepared.id]);

	const stale = await refused(call(
		routes.releasesPrepare,
		{ repositoryId: repository.id, stream: 'main', version: '1.1.0', sourceSha: plan.sourceSha, planId: 'other' },
		send,
	));
	expect([stale.status, stale.problem?.code]).toEqual([409, 'conflict']);
	expect(stale.message).toBe('Release plan changed; preview it again');

	const missing = await refused(call(routes.executionsApprove, { id: 'missing', sourceSha: plan.sourceSha }, send));
	expect([missing.status, missing.problem]).toEqual([404, { code: 'not-found', resource: 'execution', id: 'missing' }]);

	const malformed = await refused(call(routes.executionsApprove, { id: prepared.id, sourceSha: 'abc' }, send));
	expect(malformed.status).toBe(400);
	expect(malformed.problem?.code === 'invalid' && malformed.problem.issues.map(issue => issue.path)).toEqual([[
		'sourceSha',
	]]);

	const unenrolled = await refused(call(routes.repositoriesResolve, { repository: 'gadget' }, send));
	expect([unenrolled.status, unenrolled.problem?.code]).toEqual([404, 'not-found']);
	expect(world.network.unrouted).toEqual([]);
});

test('elevated routes check the request before they spend the security-key proof', async () => {
	const token = await world.cliSession();
	const repository = await discoveredWidget(world, token);
	const send = cliTransport(world, token);

	const legacyClient = await refused(call(routes.credentialsReplace, { alias: 'npm-token', value: 'secret' }, send));
	expect([legacyClient.status, legacyClient.problem?.code]).toEqual([403, 'forbidden']);
	expect(legacyClient.message).toBe('This action needs a security-key touch; upgrade the beepboop CLI');

	await world.elevate();
	const guidance = await refused(call(routes.credentialsGrant, {
		proof: 'proof',
		selection: {
			alias: 'unlisted',
			repositoryId: repository.id,
			stream: 'main',
			operation: 'promote',
			delivery: 'runtime',
		},
	}, send));
	expect([guidance.status, guidance.problem?.code]).toEqual([422, 'precondition']);
	expect(guidance.message).toBe(
		'Add this name to the selected stream’s credentials list in .github/beepboop.json first',
	);
	expect(await world.db.prepare('SELECT id FROM sessions WHERE id=?').bind('proof').first()).toEqual({ id: 'proof' });

	const unnamed = await refused(call(routes.credentialsGrant, {
		proof: 'proof',
		selection: {
			alias: 'npm-token',
			repositoryId: repository.id,
			stream: 'main',
			operation: 'promote',
			delivery: 'repository',
		},
	}, send));
	expect([unnamed.status, unnamed.problem]).toEqual([400, {
		code: 'invalid',
		issues: [{ path: ['secretName'], message: 'Secret name required' }],
	}]);
	expect(unnamed.message).toBe('secretName: Secret name required');
	expect(await world.db.prepare('SELECT id FROM sessions WHERE id=?').bind('proof').first()).toEqual({ id: 'proof' });

	const stale = await refused(call(
		routes.credentialsReplace,
		{ alias: 'npm-token', value: 'secret', proof: 'proof', expectedVersion: 3 },
		send,
	));
	expect([stale.status, stale.problem?.code]).toEqual([409, 'conflict']);
	const stored = await call(
		routes.credentialsReplace,
		{ alias: 'npm-token', value: 'secret', proof: 'proof', expectedVersion: null },
		send,
	);
	expect(stored.version).toBe(1);
	expect(await world.db.prepare('SELECT id FROM sessions WHERE id=?').bind('proof').first()).toBeNull();
	const audit = await world.db.prepare('SELECT actor, actor_json FROM audit WHERE action=?').bind('credential.replace')
		.first();
	expect(audit).toEqual({
		actor: world.env.ADMIN_SUBJECT,
		actor_json: JSON.stringify({ kind: 'admin', subject: world.env.ADMIN_SUBJECT }),
	});
});

test('a deployed CLI adds a notification destination without a security-key touch', async () => {
	const token = await world.cliSession();
	const send = cliTransport(world, token);
	await world.elevate();
	await call(
		routes.credentialsReplace,
		{ alias: 'release-hook', value: 'https://hooks.example/release', proof: 'proof', expectedVersion: null },
		send,
	);

	const saved = await bearer(world, token)('/api/notifications/save', {
		destination: {
			name: 'Releases',
			kind: 'http',
			credential: 'release-hook',
			subscribeNew: false,
			enabled: true,
		},
	});
	expect(saved.status).toBe(200);
	const listed = await call(routes.notificationsList, {}, send);
	expect(listed.destinations.map(destination => destination.name)).toEqual(['Releases']);
});

test('outages answer as retryable upstream errors and corrupt rows as internal errors', async () => {
	const { failureOf } = await import('@root/actions/runtime/protocol.ts');
	const repository = widget(world.github);
	const token = await world.cliSession();
	const send = cliTransport(world, token);

	world.network.serve('api.github.com', () => {
		throw new TypeError('Connection reset by peer');
	});
	const github = await refused(call(routes.repositoriesDiscover, { repository: 'octo/widget' }, send));
	expect([github.status, github.problem]).toEqual([502, { code: 'upstream', service: 'github', retryable: true }]);
	world.network.serve(
		'api.github.com',
		request =>
			request.method === 'POST'
				? Response.json({ message: 'Unicorn' }, { status: 502 })
				: world.github.handle(request),
	);
	const unicorn = await bearerRequest(world, token, {
		method: 'POST',
		path: '/api/repositories/discover',
		body: JSON.stringify({ repository: 'octo/widget' }),
	});
	expect(unicorn.status).toBe(502);
	expect(await Effect.runPromise(failureOf(unicorn))).toEqual({
		message: expect.stringContaining('HTTP 502 upstream'),
		retryable: true,
	});
	world.network.serve('api.github.com', request => world.github.handle(request));

	world.db.failBatch = new Error('D1_ERROR: Network connection lost.');
	const d1 = await refused(call(routes.notificationsRemove, { id: 'missing' }, send));
	expect([d1.status, d1.problem]).toEqual([502, { code: 'upstream', service: 'd1', retryable: true }]);
	world.db.failBatch = undefined;

	await world.db.prepare('INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?)')
		.bind('broken', 'npm-token', repository.id, JSON.stringify({ id: 'broken', delivery: 'carrier-pigeon' })).run();
	const corrupt = await refused(call(routes.credentialsList, {}, send));
	expect([corrupt.status, corrupt.problem?.code]).toEqual([500, 'internal']);
});

test('workflow requests retry upstream failures on idempotent endpoints only', async () => {
	const { retried } = await import('@root/actions/runtime/protocol.ts');
	const upstream = () => Response.json({ error: 'GitHub is down', problem: { code: 'upstream' } }, { status: 502 });
	const replies = (...responses: Response[]) =>
		Effect.suspend(() => {
			const next = responses.shift();
			return next ? Effect.succeed(next) : Effect.die(new Error('No reply left'));
		});
	const settle = <A, E>(effect: Effect.Effect<A, E>) =>
		Effect.runPromise(Effect.provide(
			Effect.gen(function*() {
				const fiber = yield* Effect.forkChild(Effect.result(effect));
				yield* TestClock.adjust('3 seconds');
				return yield* Fiber.join(fiber);
			}),
			TestClock.layer(),
		));
	const message = 'Beepboop request failed: HTTP 502 upstream: GitHub is down';

	expect(await settle(retried(replies(upstream(), Response.json({ ok: true })), true, 3))).toEqual(
		Result.succeed({ ok: true }),
	);
	const once = await settle(retried(replies(upstream(), Response.json({ ok: true })), false, 3));
	expect(Result.isFailure(once) && once.failure.message).toBe(message);
	const exhausted = await settle(retried(replies(upstream(), upstream()), true, 2));
	expect(Result.isFailure(exhausted) && exhausted.failure.message).toBe(message);
	const bare = await settle(retried(replies(new Response('ok')), true, 3));
	expect(Result.isFailure(bare) && bare.failure.message).toBe('Beepboop answered HTTP 200 without JSON');
	const garbled = await settle(
		retried(replies(new Response('{', { headers: { 'Content-Type': 'application/json' } })), true, 3),
	);
	expect(Result.isFailure(garbled) && garbled.failure.message).toBe('Beepboop answered HTTP 200 with invalid JSON');
});

test('a broken Worker configuration fails with a logged internal error', async () => {
	runtimeEnv.OWNER_ID = 'NaN';
	const logged: string[] = [];
	const error = console.error;
	console.error = (...values: unknown[]) => logged.push(values.map(String).join(' '));
	try {
		const response = await reply(
			await world.handle(new Request(`${origin}/api/repositories`, { headers: { Authorization: 'Bearer x' } })),
		);
		expect(response.status).toBe(500);
		expect(errorEnvelope.parse(response.body).problem?.code).toBe('internal');
	} finally {
		console.error = error;
	}
	expect(logged.some(line => line.includes('Worker configuration invalid: OWNER_ID'))).toBe(true);
});

test('the Actions request builders produce bodies the server parses', async () => {
	const { endpoints, modes, requestBody } = await import('@root/actions/runtime/protocol.ts');
	const ids = {
		start: 'workflowStart',
		begin: 'workflowBegin',
		prepared: 'workflowPrepared',
		report: 'workflowReport',
		credentials: 'workflowCredentials',
		'refs-plan': 'workflowRefsPlan',
		'refs-complete': 'workflowRefsComplete',
		release: 'workflowRelease',
		token: 'workflowToken',
	} as const satisfies Record<(typeof modes)[number], keyof typeof routes>;
	const prepared = `${import.meta.dir}/prepared.json`;
	await Bun.write(prepared, JSON.stringify({ executionId: 'e1', files: [{ path: 'package.json', content: '{}' }] }));
	const environment = {
		EXECUTION_ID: 'e1',
		STREAM: 'main',
		OPERATION: 'promote',
		RELEASE_VERSION: '1.2.3',
		PREPARED_FILE: prepared,
		PUBLICATIONS: JSON.stringify([
			{
				id: 'pkg:npm/widget',
				manager: 'npm',
				name: 'widget',
				version: '1.2.3',
				outcome: 'rate-limited',
				retryAfter: '120',
			},
		]),
		ARTIFACTS: '[]',
		ALIASES: '["npm-token"]',
		PERMISSIONS: '{"contents":"write"}',
		TOKEN_IDENTITY: 'true',
	};
	try {
		for (const mode of modes) {
			const route = routes[ids[mode]];
			const mirrored: { path: string; idempotent: boolean } = endpoints[mode];
			expect({ mode, ...mirrored }).toEqual({ mode, path: route.path, idempotent: route.idempotent });
			const parsed = route.request.safeParse(
				Result.getOrThrow(requestBody(mode, environment, Date.parse('2026-11-04T09:00:00Z'))),
			);
			expect({ mode, issues: parsed.error?.issues ?? [] }).toEqual({ mode, issues: [] });
		}
		const report = routes.workflowReport.request.parse(
			Result.getOrThrow(requestBody('report', environment, Date.parse('2026-11-04T09:00:00Z'))),
		);
		expect(report.publications).toEqual([
			{
				id: 'pkg:npm/widget',
				manager: 'npm',
				name: 'widget',
				version: '1.2.3',
				outcome: 'rate-limited',
				retryAfter: '2026-11-04T09:02:00.000Z',
			},
		]);
	} finally {
		await Bun.file(prepared).delete();
	}
});

test('the token action reads permission-* inputs, the permissions JSON, or neither', async () => {
	const { requestBody } = await import('@root/actions/runtime/protocol.ts');
	const permissions = (environment: Record<string, string>) =>
		Result.map(requestBody('token', environment), body => routes.workflowToken.request.parse(body).permissions);
	const inputs = JSON.stringify({
		service: 'https://beepboop.kjanat.dev',
		'permission-contents': 'write',
		'permission-pull-requests': 'read',
		'permission-issues': '',
		permissions: '',
	});
	expect(Result.getOrThrow(permissions({ INPUTS: inputs }))).toEqual({ contents: 'write', pull_requests: 'read' });
	expect(Result.getOrThrow(permissions({ PERMISSIONS: '{"issues":"write"}' }))).toEqual({ issues: 'write' });
	expect(Result.getOrThrow(permissions({ INPUTS: '{"permission-checks":""}' }))).toEqual({
		contents: 'write',
		pull_requests: 'write',
	});
	const both = permissions({ INPUTS: inputs, PERMISSIONS: '{"issues":"write"}' });
	expect(Result.isFailure(both) && both.failure.message).toBe('Set either permissions or the permission-* inputs');
});
