import targetsSchema from '@root/schemas/targets.v1.json';
import schema from '@root/schemas/v1.json' with { type: 'json' };
import { Effect } from 'effect';
import { authRoute } from '@/automation/auth';
import type { AutomationBindings } from '@/automation/service';
import { AutomationService } from '@/automation/service';
import type { DomainError } from '@/contract/errors';
import { domainError, notFound } from '@/contract/errors';
import type { Method, RouteId } from '@/contract/routes';
import { routeIds, routes } from '@/contract/routes';
import { fromSync } from '@/failure';
import { endpoints } from '@/server/handlers/index';
import type { Endpoint } from '@/server/handlers/kit';
import { readBody } from '@/webhook';

interface RawRoute {
	methods: readonly Method[];
	serve(request: Request, service: AutomationService): Effect.Effect<Response, DomainError>;
}

export const rawRoutes: ReadonlyMap<string, RawRoute> = new Map<string, RawRoute>([
	['/health', {
		methods: ['GET'],
		serve: () => Effect.sync(() => Response.json({ service: 'beepboop', mode: 'automation' })),
	}],
	['/schema/targets.v1.json', { methods: ['GET'], serve: () => Effect.sync(() => Response.json(targetsSchema)) }],
	['/schema/v1.json', { methods: ['GET'], serve: () => Effect.sync(() => Response.json(schema)) }],
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

function methodNotAllowed(allowed: readonly Method[]) {
	return domainError({ code: 'method-not-allowed', allowed: [...allowed] });
}

function input(request: Request, method: Method): Effect.Effect<unknown, DomainError> {
	if (method === 'GET') return Effect.sync(() => Object.fromEntries(new URL(request.url).searchParams));
	return readBody(request).pipe(
		Effect.flatMap(bytes => fromSync((): unknown => JSON.parse(new TextDecoder().decode(bytes)))),
	);
}

export function dispatch(
	request: Request,
	env: AutomationBindings,
	defer?: (work: Promise<void>) => void,
): Effect.Effect<Response, DomainError> {
	return Effect.gen(function*() {
		const path = new URL(request.url).pathname;
		const service = new AutomationService(env, defer);
		const raw = rawRoutes.get(path);
		if (raw) {
			if (!raw.methods.some(method => method === request.method)) return yield* methodNotAllowed(raw.methods);
			return yield* raw.serve(request, service);
		}
		if (path.startsWith('/auth/')) {
			const response = yield* authRoute(request, env);
			if (response) return response;
			return yield* notFound('route', 'Not found');
		}
		const methods = table.get(path);
		if (!methods) return yield* notFound('route', 'Not found');
		const id = resolve(request.method, path);
		if (!id) return yield* methodNotAllowed([...methods.keys()]);
		const method = routes[id].method;
		const endpoint: Pick<Endpoint<never>, 'run'> = endpoints[id];
		return Response.json(yield* endpoint.run({ request, env, service }, input(request, method)));
	});
}
