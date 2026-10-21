import { DurableObject } from 'cloudflare:workers';
import { configuration } from '#config';
import { dashboard } from '#dashboard';
import { type Credentials, GitHub } from '#github';
import { compareVersions, type Journal, type Operation } from '#model';
import { Router } from '#router';
import { acceptsEvent, readBody, verifySignature } from '#webhook';
import { type AutomationBindings, AutomationService } from './automation/service.ts';

export { AutomationCoordinator } from './automation/coordinator.ts';
export { VermonEvents } from './automation/vermon.ts';

export interface Bindings extends Credentials {
	GITHUB_WEBHOOK_SECRET: string;
	COORDINATOR: DurableObjectNamespace<ReleaseCoordinator>;
	AUTOMATION_ENABLED?: string;
}
export class ReleaseCoordinator extends DurableObject<Bindings> implements Journal {
	private pending: Promise<void> = Promise.resolve();
	get(id: string): Promise<Operation | undefined> {
		return this.ctx.storage.get<Operation>(`operation:${id}`);
	}
	put(operation: Operation): Promise<void> {
		return this.ctx.storage.put(`operation:${operation.id}`, operation);
	}
	async all(): Promise<Operation[]> {
		return [...(await this.ctx.storage.list<Operation>({ prefix: 'operation:' })).values()];
	}
	async status(): Promise<{
		operations: Operation[];
		discovery: { routeId: string; healthy: boolean; updatedAt: number }[];
	}> {
		const discovery = await this.ctx.storage.list<{
			routeId: string;
			healthy: boolean;
			updatedAt: number;
		}>({ prefix: 'discovery:' });
		return { operations: await this.all(), discovery: [...discovery.values()] };
	}
	watermark(routeId: string): Promise<string | undefined> {
		return this.ctx.storage.get<string>(`watermark:${routeId}`);
	}
	async advance(routeId: string, version: string): Promise<void> {
		const old = await this.watermark(routeId);
		if (!old || compareVersions(version, old) > 0) {
			await this.ctx.storage.put(`watermark:${routeId}`, version);
		}
	}
	async wake(): Promise<void> {
		// Persist the wake-up before replying: webhook delivery can be acknowledged independently of GitHub availability.
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + 1_000);
		}
	}
	async alarm(): Promise<void> {
		const work = this.pending.then(() => this.reconcile());
		this.pending = work.catch(() => {});
		await work;
	}
	async reconcile(): Promise<void> {
		if (!configuration.enabled) return;
		// Set the next alarm before network calls; unexpected failures cannot strand operations.
		await this.ctx.storage.setAlarm(Date.now() + 60_000);
		const router = new Router(this, new GitHub(this.env, configuration.ownerId));
		for (const route of configuration.routes) {
			if (route.enabled === false) continue;
			try {
				await router.discover(route);
				await this.ctx.storage.put(`discovery:${route.id}`, {
					routeId: route.id,
					healthy: true,
					updatedAt: Date.now(),
				});
			} catch {
				await this.ctx.storage.put(`discovery:${route.id}`, {
					routeId: route.id,
					healthy: false,
					updatedAt: Date.now(),
				});
			}
		}
		for (const operation of await this.all()) {
			const route = configuration.routes.find((route) => route.id === operation.routeId);
			if (route) await router.tick(route, operation);
		}
	}
}
export default {
	async fetch(request: Request, env: Bindings): Promise<Response> {
		if (env.AUTOMATION_ENABLED === 'true') {
			try {
				const response = await new AutomationService(env as unknown as AutomationBindings).fetch(
					request,
				);
				const headers = new Headers(response.headers);
				headers.set('Cache-Control', 'no-store');
				headers.set('X-Content-Type-Options', 'nosniff');
				return new Response(response.body, { status: response.status, headers });
			} catch (error) {
				// Avoid returning arbitrary upstream error bodies or credential-bearing diagnostics.
				return Response.json(
					{
						error: error instanceof SyntaxError
							? 'Invalid JSON in request or configuration'
							: error instanceof Error && !/token|secret|credential/i.test(error.message)
							? error.message
							: 'Request denied or unavailable',
					},
					{ status: 400, headers: { 'Cache-Control': 'no-store' } },
				);
			}
		}
		const url = new URL(request.url);
		if (url.pathname === '/' && request.method === 'GET') {
			const status = await env.COORDINATOR.getByName('account').status();
			return dashboard(configuration, status.operations, status.discovery);
		}
		if (url.pathname === '/health' && request.method === 'GET') {
			return Response.json({ service: 'beepboop', enabled: configuration.enabled });
		}
		if (url.pathname === '/operations' && request.method === 'GET') {
			return Response.json(await env.COORDINATOR.getByName('account').status());
		}
		if (url.pathname !== '/webhooks/github' || request.method !== 'POST') {
			return new Response('Not found', { status: 404 });
		}
		try {
			const body = await readBody(request);
			if (
				!(await verifySignature(
					body,
					request.headers.get('x-hub-signature-256'),
					env.GITHUB_WEBHOOK_SECRET,
				))
			) {
				return new Response('Invalid signature', { status: 401 });
			}
			const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
			if (!acceptsEvent(request.headers.get('x-github-event'), payload, configuration)) {
				return new Response(null, { status: 204 });
			}
			if (configuration.enabled) await env.COORDINATOR.getByName('account').wake();
			return new Response('Accepted', { status: 202 });
		} catch {
			return new Response('Invalid webhook', { status: 400 });
		}
	},
	async scheduled(_event: ScheduledController, env: Bindings): Promise<void> {
		if (env.AUTOMATION_ENABLED === 'true') {
			await new AutomationService(env as unknown as AutomationBindings).scheduled();
			return;
		}
		if (configuration.enabled) await env.COORDINATOR.getByName('account').wake();
	},
} satisfies ExportedHandler<Bindings>;
