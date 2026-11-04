import schema from '@root/schemas/v1.json' with { type: 'json' };
import { authRoute } from '@/automation/auth';
import type { AutomationBindings } from '@/automation/service';
import { AutomationService } from '@/automation/service';
import { DomainError, notFound } from '@/contract/errors';
import { type Method, type RouteId, routeIds, routes } from '@/contract/routes';
import { endpoints } from '@/server/handlers/index';
import type { Context } from '@/server/handlers/kit';
import { readBody } from '@/webhook';

interface RawRoute {
	methods: readonly Method[];
	serve(request: Request, service: AutomationService): Promise<Response>;
}

export const rawRoutes: ReadonlyMap<string, RawRoute> = new Map<string, RawRoute>([
	['/health', { methods: ['GET'], serve: async () => Response.json({ service: 'beepboop', mode: 'automation' }) }],
	['/schema/v1.json', { methods: ['GET'], serve: async () => Response.json(schema) }],
	['/webhooks/github', { methods: ['POST'], serve: (request, service) => service.webhook(request) }],
]);

const table = new Map<string, Map<Method, RouteId>>();
for (const id of routeIds) {
	const { path, method } = routes[id];
	const methods = table.get(path) ?? new Map<Method, RouteId>();
	methods.set(method, id);
	table.set(path, methods);
}

export function resolve(method: string, path: string): RouteId | undefined {
	return [...(table.get(path) ?? [])].find(([candidate]) => candidate === method)?.[1];
}

function methodNotAllowed(allowed: readonly Method[]): DomainError {
	return new DomainError({ code: 'method-not-allowed', allowed: [...allowed] });
}

async function input(request: Request, method: Method): Promise<unknown> {
	if (method === 'GET') return {};
	return JSON.parse(new TextDecoder().decode(await readBody(request)));
}

export async function dispatch(request: Request, env: AutomationBindings): Promise<Response> {
	const path = new URL(request.url).pathname;
	const service = new AutomationService(env);
	const raw = rawRoutes.get(path);
	if (raw) {
		if (!raw.methods.some(method => method === request.method)) throw methodNotAllowed(raw.methods);
		return raw.serve(request, service);
	}
	if (path.startsWith('/auth/')) {
		const response = await authRoute(request, env);
		if (response) return response;
		throw notFound('route', 'Not found');
	}
	const methods = table.get(path);
	if (!methods) throw notFound('route', 'Not found');
	const id = resolve(request.method, path);
	if (!id) throw methodNotAllowed([...methods.keys()]);
	const method = routes[id].method;
	const endpoint: { run(context: Context, read: () => Promise<unknown>): Promise<unknown> } = endpoints[id];
	return Response.json(await endpoint.run({ request, env, service }, () => input(request, method)));
}
