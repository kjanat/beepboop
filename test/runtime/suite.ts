import { afterEach, beforeEach, describe, it } from 'bun:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime, type Runtime } from '@root/test/runtime/environment';
import { fixture, managed } from '@root/test/runtime/fixtures';
import type { Execution } from '@/automation/types';

describe('built Cloudflare Worker', () => {
	let context: Runtime;
	beforeEach(async () => {
		context = await createRuntime();
		await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify(fixture),
		});
	});
	afterEach(async () => {
		await context?.close();
	});

	it('authentication gates', async () => {
		assert.equal((await context.fetch('https://automation.test/health')).status, 200);
		assert.equal(
			(await context.fetch('https://automation.test/api/credentials')).status,
			401,
		);
		assert.equal(
			(
				await context.fetch('https://automation.test/api/executions/start', {
					method: 'POST',
					body: '{}',
				})
			).status,
			401,
		);
	});

	it('immutable execution enqueue', async () => {
		const response = await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify(fixture),
		});
		assert.equal(response.status, 200);
		const first = (await response.json()) as Execution;
		assert.equal(first.sourceSha, fixture.sourceSha);
		const duplicate = await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify({ ...fixture, sourceSha: 'c'.repeat(40) }),
		});
		assert.equal(((await duplicate.json()) as typeof fixture).sourceSha, fixture.sourceSha);
	});

	it('unrelated webhooks do not contact GitHub', async () => {
		const body = JSON.stringify({
			action: 'published',
			repository: { id: 999, full_name: 'example/unrelated', owner: { id: 1 } },
		});
		const signature = createHmac('sha256', 'fixture-secret').update(body).digest('hex');
		const ignored = await context.fetch('https://automation.test/webhooks/github', {
			method: 'POST',
			body,
			headers: { 'x-github-event': 'release', 'x-hub-signature-256': `sha256=${signature}` },
		});
		assert.equal(ignored.status, 204);
		assert.equal(context.network.outbound, 0);
	});

	it('authenticated dashboard pages and security headers', async () => {
		for (const path of ['/', '/repositories', '/releases', '/runs', '/winget', '/secrets', '/activity', '/security']) {
			const page = await context.fetch(`https://automation.test${path}`, {
				redirect: 'manual',
				headers: { cookie: `__Host-beepboop_access=${context.access}` },
			});
			assert.equal(page.status, 200, `Authenticated Astro page ${path}: ${await page.clone().text()}`);
			const html = await page.text();
			assert.match(html, /Beepboop/);
			assert.match(html, /<nav aria-label="Main navigation"/);
			assert.ok(page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
			assert.ok(page.headers.get('content-security-policy')?.includes("style-src 'self';"));
			assert.ok(!page.headers.get('content-security-policy')?.includes("'unsafe-inline'"));
		}
		const absent = await context.fetch('https://automation.test/no-such-page');
		assert.equal(absent.status, 404);
	});

	it('login rejects invalid flows and accepts a fresh exchange', async () => {
		const wingetUnauthorized = await context.fetch('https://automation.test/api/winget');
		assert.equal(wingetUnauthorized.status, 401);
		const cookieless = await context.fetch('https://automation.test/auth/callback?code=c&state=s', {
			redirect: 'manual',
		});
		assert.equal(cookieless.status, 401);
		assert.match(await cookieless.text(), /Sign in again/);
		const stale = await context.fetch('https://automation.test/auth/callback?code=c&state=s', {
			redirect: 'manual',
			headers: { cookie: '__Host-beepboop_flow=no-such-flow' },
		});
		assert.equal(stale.status, 302);
		assert.equal(stale.headers.get('location'), '/auth/login');
		const login = await context.fetch('https://automation.test/auth/login', { redirect: 'manual' });
		assert.equal(login.status, 302);
		const flowId = /__Host-beepboop_flow=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1];
		const state = new URL(login.headers.get('location') ?? '').searchParams.get('state');
		assert.ok(flowId && state);
		const unreachable = await context.fetch(
			`https://automation.test/auth/callback?code=c&state=${encodeURIComponent(state)}`,
			{ redirect: 'manual', headers: { cookie: `__Host-beepboop_flow=${flowId}` } },
		);
		assert.equal(unreachable.status, 401);
		assert.match(await unreachable.text(), /Login exchange failed/);
		const reusedLogin = await context.fetch(
			`https://automation.test/auth/callback?code=c&state=${encodeURIComponent(state)}`,
			{ redirect: 'manual', headers: { cookie: `__Host-beepboop_flow=${flowId}` } },
		);
		assert.equal(reusedLogin.headers.get('location'), '/auth/login');
		context.network.allowExchange = true;
		const freshLogin = await context.fetch('https://automation.test/auth/login', {
			redirect: 'manual',
		});
		const freshLocation = new URL(freshLogin.headers.get('location') ?? '');
		assert.equal(freshLocation.searchParams.get('redirect_uri'), 'https://automation.test/auth/callback');
		assert.equal(freshLocation.searchParams.get('code_challenge_method'), 'S256');
		const freshCookie = freshLogin.headers.get('set-cookie')?.split(';')[0];
		assert.ok(freshCookie);
		const callback = await context.fetch(
			`https://automation.test/auth/callback?code=fixture&state=${freshLocation.searchParams.get('state')}`,
			{ redirect: 'manual', headers: { cookie: freshCookie } },
		);
		assert.equal(callback.status, 302, await callback.clone().text());
		const sessionCookie = callback.headers.get('set-cookie')?.split(';')[0];
		assert.ok(sessionCookie);
		assert.ok(sessionCookie.startsWith('__Host-beepboop_access='));
		const signedIn = await context.fetch('https://automation.test/', {
			redirect: 'manual',
			headers: { cookie: sessionCookie },
		});
		assert.equal(signedIn.status, 200);
		assert.match(await signedIn.text(), /What needs to ship/);
	});

	it('execution index and release events survive restart', async () => {
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
		const completed = await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify(released),
		});
		assert.equal(completed.status, 200);
		const events = await (await context.fetch('https://automation.test/events')).json() as {
			release: { commit: string; repository: { id: number }; version: string };
		}[];
		assert.equal(events.length, 1);
		assert.equal(events[0]?.release.commit, fixture.sourceSha);
		assert.equal(events[0]?.release.repository.id, fixture.repositoryId);
		assert.equal(events[0]?.release.version, '1.2.3');
		await context.restart();
		const journal = await context.fetch('https://automation.test/journal');
		assert.equal(((await journal.json()) as typeof fixture).sourceSha, fixture.sourceSha);
		const index = await context.fetch('https://automation.test/index');
		const indexed = (await index.json()) as { results: { document: string }[] };
		assert.equal(indexed.results.length, 2);
		assert.ok(indexed.results.some(row => JSON.parse(row.document).state === 'blocked'));
		const durableEvents = await (await context.fetch('https://automation.test/events'))
			.json() as unknown[];
		assert.equal(durableEvents.length, 1);
	});

	it('managed preparation recovers after checkpoint interruption', async () => {
		await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify(managed),
		});
		const interrupted = await (await context.fetch('https://automation.test/tick-managed')).json() as {
			state: string;
			managed: { head: string; result?: { head: string } };
		};
		assert.equal(interrupted.state, 'uncertain');
		assert.equal(interrupted.managed.head, 'c'.repeat(40));
		await context.restart();
		const resumed = await (await context.fetch('https://automation.test/tick-managed'))
			.json() as typeof interrupted;
		assert.equal(resumed.state, 'succeeded');
		assert.equal(resumed.managed.result?.head, interrupted.managed.head);
	});

	it('workflow preparation recovers after restart', async () => {
		const workflowPreparation = {
			...fixture,
			id: 'workflow-prep',
			operation: 'prepare',
			state: 'running',
			runId: 10,
			runAttempt: 1,
			workflowSha: 'a'.repeat(40),
			plan: {
				sourceSha: fixture.sourceSha,
				version: '2.0.0',
				edits: [{ path: 'version.txt', before: '1', after: '2' }],
			},
		};
		await context.fetch('https://automation.test/enqueue', {
			method: 'POST',
			body: JSON.stringify(workflowPreparation),
		});
		const interruptedWorkflow = await context.fetch('https://automation.test/prepared-probe');
		assert.equal(interruptedWorkflow.status, 500);
		await context.restart();
		const resumedWorkflow = await (await context.fetch('https://automation.test/prepared-probe'))
			.json() as {
				head: string;
			};
		assert.equal(resumedWorkflow.head, 'c'.repeat(40));
	});

	it.each([false, true])(
		'Cloudflare release Workflow resumes without duplicate dispatch (lost response: %s)',
		async lost => {
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
							workflows: {
								build: { file: 'release.yml' },
								publish: { file: 'release.yml', needs: ['build'] },
								docs: { file: 'release.yml' },
							},
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
						operations: ['build', 'publish', 'docs'].map(id => ({
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
			await context.fetch('https://automation.test/enqueue', {
				method: 'POST',
				body: JSON.stringify(setPreparation),
			});
			const started = await (await context.fetch(`https://automation.test/start-set${lost ? '?lost=1' : ''}`))
				.json() as {
					id: string;
					version: string;
					dependencies: string[];
				}[];
			assert.equal(started.length, 3);
			assert.equal(started[0]?.version, '2.0.0');
			assert.deepEqual(started[1]?.dependencies, [started[0]?.id]);
			// Start the real Workflow engine; the publication must wait for the build.
			await context.fetch('https://automation.test/tick-managed');
			async function progress() {
				return (await (await context.fetch('https://automation.test/set-progress')).json()) as {
					status: { status: string };
					dispatches: number;
					executions: { id: string; state: string; attempts: number }[];
				};
			}
			async function until(predicate: (value: Awaited<ReturnType<typeof progress>>) => boolean) {
				for (let i = 0; i < 100; i++) {
					const value = await progress();
					if (predicate(value)) return value;
					await Bun.sleep(50);
				}
				throw new Error(`Workflow did not reach expected state: ${JSON.stringify(await progress())}`);
			}
			const waiting = await until(value =>
				value.executions[0]?.state === 'running' && value.executions[2]?.state === 'running'
			);
			assert.equal(waiting.executions[1]?.attempts, 0);
			assert.equal(waiting.dispatches, 2);
			await context.restart();
			const replayed = await (await context.fetch('https://automation.test/start-set'))
				.json() as typeof started;
			assert.deepEqual(replayed.map(execution => execution.id), started.map(execution => execution.id));
			if (lost) {
				const interruption = await context.fetch('https://automation.test/interrupt-set');
				assert.equal(interruption.status, 200);
				await until(value => value.status.status === 'terminated');
				await context.fetch('https://automation.test/notify-set');
				const interrupted = await context.fetch('https://automation.test/runs', {
					headers: { cookie: `__Host-beepboop_access=${context.access}` },
				});
				assert.match(await interrupted.text(), /Release coordination interrupted/);
				assert.equal((await context.fetch('https://automation.test/recover-set')).status, 200);
			}
			await context.fetch('https://automation.test/finish-set');
			const completed = await until(value => value.status.status === 'complete');
			assert.deepEqual(completed.executions.map(execution => execution.state), ['succeeded', 'succeeded', 'succeeded']);
			assert.deepEqual(completed.executions.map(execution => execution.attempts), [1, 1, 1]);
			const overview = await context.fetch('https://automation.test/runs', {
				headers: { cookie: `__Host-beepboop_access=${context.access}` },
			});
			assert.equal(overview.status, 200);
			const html = await overview.text();
			assert.match(html, /Monorepo release/);
			assert.match(html, /3 of 3 operations complete/);
			assert.doesNotMatch(html, /Release coordination interrupted/);
		},
	);

	it('promotion requires dispatch, signatures, and successful checks', async () => {
		const premature = await context.fetch('https://automation.test/register-probe');
		assert.equal(premature.status, 400);
		assert.match((await premature.json() as { error: string }).error, /not been dispatched/);
		const unsigned = await context.fetch('https://automation.test/approve-probe?unsigned=1');
		assert.equal(unsigned.status, 400);
		assert.match((await unsigned.json() as { error: string }).error, /signature/);
		const failedChecks = await context.fetch('https://automation.test/approve-probe?failed=1');
		assert.equal(failedChecks.status, 400);
		assert.match((await failedChecks.json() as { error: string }).error, /checks/);
		const approved = await context.fetch('https://automation.test/approve-probe');
		assert.equal(approved.status, 200);
		assert.equal((await approved.json() as { state: string }).state, 'ready');
	});
});

describe('built Worker CLI authentication', () => {
	it('exchanges a browser-approved challenge and uses then revokes a real API session', async () => {
		const runtime = await createRuntime();
		try {
			const verifier = 'ab'.repeat(32);
			const challenge = new Bun.CryptoHasher('sha256').update(verifier).digest('hex');
			const path = `https://automation.test/auth/cli/authorize?challenge=${challenge}`;
			const headers = { cookie: `__Host-beepboop_access=${runtime.access}`, origin: 'https://automation.test' };
			assert.equal((await runtime.fetch(path, { headers })).status, 200);
			assert.equal((await runtime.fetch(path, { method: 'POST', headers })).status, 200);
			const exchange = await runtime.fetch('https://automation.test/auth/cli/token', {
				method: 'POST',
				body: verifier,
			});
			assert.equal(exchange.status, 200);
			const { token } = await exchange.json() as { token: string };
			const authorization = { authorization: `Bearer ${token}` };
			assert.equal(
				(await runtime.fetch('https://automation.test/api/repositories', { headers: authorization })).status,
				200,
			);
			assert.equal(
				(await runtime.fetch('https://automation.test/auth/cli/logout', { method: 'POST', headers: authorization }))
					.status,
				200,
			);
			assert.equal(
				(await runtime.fetch('https://automation.test/api/repositories', { headers: authorization })).status,
				401,
			);
			assert.equal(
				(await runtime.fetch('https://automation.test/auth/cli/token', { method: 'POST', body: verifier })).status,
				202,
			);
		} finally {
			await runtime.close();
		}
	}, 30000);
});

describe('built Worker package identity persistence', () => {
	it('writes canonical publication identities to the journal and D1, including after restart', async () => {
		const runtime = await createRuntime();
		try {
			const publication = {
				id: 'npm:@Scope/Tool',
				manager: 'npm',
				name: '@Scope/Tool',
				version: '1.0.0',
				outcome: 'pending',
				required: true,
			};
			const response = await runtime.fetch('https://automation.test/enqueue', {
				method: 'POST',
				body: JSON.stringify({ ...fixture, publications: [publication] }),
			});
			assert.equal(response.status, 200);
			assert.equal(((await response.json()) as Execution).publications[0]?.id, 'pkg:npm/%40Scope/Tool');
			await runtime.restart();
			const journal = await runtime.fetch('https://automation.test/journal');
			const saved = await journal.json() as Execution;
			assert.equal(saved.publications[0]?.id, 'pkg:npm/%40Scope/Tool');
			assert.deepEqual(saved.publications[0]?.identity, {
				type: 'npm',
				namespace: '@Scope',
				name: 'Tool',
				version: '1.0.0',
			});
			const responseIndex = await runtime.fetch('https://automation.test/api/executions', {
				headers: { cookie: `__Host-beepboop_access=${runtime.access}` },
			});
			const indexed = await responseIndex.json() as Execution[];
			assert.deepEqual(indexed[0]?.publications, saved.publications);
		} finally {
			await runtime.close();
		}
	}, 30000);
});
