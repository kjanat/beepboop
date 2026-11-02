import { seedBrowser } from '@root/test/runtime/browser-fixture';
import { FixtureGateway } from '@root/test/runtime/gateway';
import type { WorkflowIdentity } from '@/automation/auth';
import type { Execution } from '@/automation/types';
import worker, { AutomationCoordinator } from '@/index';

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
				return Response.json(await this.enqueue(await request.json<Execution>()));
			case '/events':
				return Response.json(await this.releaseEvents());
			case '/approve-probe':
				this.fixtureGateway.invalidSignature = url.searchParams.has('unsigned');
				this.fixtureGateway.invalidCheck = url.searchParams.has('failed');
				return this.expectedFailure(() => this.approve('fixture-execution', 'b'.repeat(40), 'fixture'));
			case '/register-probe':
				return this.expectedFailure(() => this.register('fixture-execution', { ...identity, runId: 12 }));
			case '/start-set':
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
	'/prepared-probe',
	'/approve-probe',
	'/register-probe',
]);
export default {
	async fetch(request: Request, env: Env & { MIGRATIONS: string }, ctx: ExecutionContext): Promise<Response> {
		const local = new URL(request.url);
		request = new Request(new URL(local.pathname + local.search, env.APPLICATION_ORIGIN), request);
		const path = local.pathname;
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
