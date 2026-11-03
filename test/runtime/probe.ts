import { seedBrowser, seedOnboarding } from '@root/test/runtime/browser-fixture';
import { FixtureGateway } from '@root/test/runtime/gateway';
import type { WorkflowIdentity } from '@/automation/auth';
import { executionSchema } from '@/automation/schemas';
import worker, { AutomationCoordinator } from '@/index';

export { ReleaseWorkflow } from '@/index';

const identity: WorkflowIdentity = {
	repositoryId: 91,
	repository: 'example/seventh',
	ownerId: 1,
	actorId: 1,
	runId: 10,
	attempt: 1,
	sha: 'b'.repeat(40),
	workflowSha: 'a'.repeat(40),
	workflowRef: 'example/seventh/.github/workflows/release.yml@refs/heads/main',
	ref: 'refs/heads/main',
	event: 'workflow_dispatch',
};

/** Test-only HTTP access to the coordinator under test. */
export class Probe extends AutomationCoordinator {
	private readonly fixtureGateway = new FixtureGateway(this.env, 1);
	protected override gateway() {
		return this.fixtureGateway;
	}
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/enqueue':
				return Response.json(await this.enqueue(executionSchema.parse(await request.json())));
			case '/events':
				return Response.json(await this.releaseEvents());
			case '/approve-probe':
				this.fixtureGateway.invalidSignature = url.searchParams.has('unsigned');
				this.fixtureGateway.invalidCheck = url.searchParams.has('failed');
				return this.expectedFailure(() => this.approve('fixture-execution', 'b'.repeat(40), 'fixture'));
			case '/register-probe':
				return this.expectedFailure(() => this.register('fixture-execution', { ...identity, runId: 12 }));
			case '/set-progress': {
				const instance = await this.env.RELEASE_WORKFLOW.get('release-set-prep');
				const operations = await this.releaseOperations('set-prep', 'release-set-prep');
				return Response.json({
					status: await instance.status(),
					dispatches: this.fixtureGateway.dispatchedIds.length,
					executions: await Promise.all(operations.map(op => this.ctx.storage.get(`execution:${op.id}`))),
				});
			}
			case '/finish-set':
				this.fixtureGateway.finished = true;
				await this.wake();
				await this.alarm();
				return new Response('ok');
			case '/interrupt-set':
				await (await this.env.RELEASE_WORKFLOW.get('release-set-prep')).terminate();
				return new Response('ok');
			case '/notify-set':
				await this.wake();
				await this.alarm();
				return new Response('ok');
			case '/recover-set': {
				const [operation] = await this.releaseOperations('set-prep', 'release-set-prep');
				if (!operation) throw new Error('Missing release operation');
				return Response.json(await this.recover(operation.id, 'reconcile', 'fixture'));
			}
			case '/start-set':
				this.fixtureGateway.lostDispatchResponse = url.searchParams.has('lost');
				return Response.json(await this.startReleaseSet('set-prep', 'd'.repeat(40)));
			case '/prepared-probe':
				return Response.json(
					await this.prepared('workflow-prep', identity, [{ path: 'version.txt', before: '1', after: '2' }]),
				);
			case '/tick-managed':
				await this.alarm();
				return Response.json(await this.ctx.storage.get('execution:managed-fixture'));
			case '/journal':
				return Response.json(await this.ctx.storage.get('execution:fixture-execution'));
			default:
				return new Response('Unknown probe route', { status: 404 });
		}
	}
	private async expectedFailure(action: () => Promise<unknown>): Promise<Response> {
		try {
			return Response.json(await action());
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
		}
	}
}

const probeRoutes = new Set([
	'/enqueue',
	'/journal',
	'/events',
	'/tick-managed',
	'/start-set',
	'/set-progress',
	'/finish-set',
	'/interrupt-set',
	'/notify-set',
	'/recover-set',
	'/prepared-probe',
	'/approve-probe',
	'/register-probe',
]);
export default {
	async fetch(request: Request, env: Env & { MIGRATIONS: string }, ctx: ExecutionContext): Promise<Response> {
		const local = new URL(request.url);
		request = new Request(new URL(local.pathname + local.search, env.APPLICATION_ORIGIN), request);
		const path = local.pathname;
		if (path === '/onboarding-init') {
			await seedOnboarding(env.DB);
			return new Response('ready');
		}
		if (path === '/browser-init') {
			await seedBrowser(env.DB);
			return new Response('ready');
		}
		if (path === '/init') {
			for (const sql of env.MIGRATIONS.split(';').filter(sql => sql.trim())) await env.DB.prepare(sql).run();
			return new Response('ready');
		}
		if (path === '/index') return Response.json(await env.DB.prepare('SELECT document FROM executions').all());
		if (probeRoutes.has(path)) return env.AUTOMATION.getByName('91').fetch(request);
		return worker.fetch(request, env, ctx);
	},
};
