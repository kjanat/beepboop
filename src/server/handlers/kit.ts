import type { z } from 'zod';
import { Authenticators, administrator, type WorkflowIdentity, workflowIdentity } from '@/automation/auth';
import type { AutomationBindings, AutomationService } from '@/automation/service';
import type { RepositoryRecord } from '@/automation/types';
import { forbidden, parseRequest } from '@/contract/errors';
import type { AnyRoute, Known, Route } from '@/contract/routes';
import { readiness } from '@/domain/repository';

export interface Context {
	request: Request;
	env: AutomationBindings;
	service: AutomationService;
}
export interface AdminContext extends Context {
	actor: string;
}
export interface WorkflowContext extends Context {
	identity: WorkflowIdentity;
}
export interface EnrolledContext extends WorkflowContext {
	enrollment: RepositoryRecord;
}

export interface Endpoint<R extends AnyRoute> {
	route: R;
	run(context: Context, read: () => Promise<unknown>): Promise<unknown>;
}

type Effect<T> = () => Promise<T>;
type Handle<Q extends z.ZodType, S extends z.ZodType, C> = (
	input: z.output<Q>,
	context: C,
) => Promise<Known<z.input<S>>>;

function respond<S extends z.ZodType>(schema: S, result: Known<z.input<S>>): Known<z.input<S>> {
	schema.parse(result);
	return result;
}

export function admin<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, AdminContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		async run(context, read) {
			const actor = await administrator(context.request, context.env);
			return respond(route.response, await handle(parseRequest(route.request, await read()), { ...context, actor }));
		},
	};
}

const upgrade = 'This action needs a security-key touch; upgrade the beepboop CLI';

export function elevated<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	precheck: (input: z.output<Q>, context: AdminContext) => Promise<Effect<Known<z.input<S>>>>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		async run(context, read) {
			const actor = await administrator(context.request, context.env);
			const raw = await read();
			const proof = typeof raw === 'object' && raw !== null && 'proof' in raw ? raw.proof : undefined;
			if (typeof proof !== 'string') throw forbidden(upgrade);
			const effect = await precheck(parseRequest(route.request, raw), { ...context, actor });
			await new Authenticators(context.env).consume(actor, proof);
			return respond(route.response, await effect());
		},
	};
}

async function identify(context: Context): Promise<WorkflowIdentity> {
	return workflowIdentity(context.request, context.env.APPLICATION_ORIGIN, Number(context.env.OWNER_ID));
}

export function workflowToken<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, WorkflowContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		async run(context, read) {
			const identity = await identify(context);
			return respond(route.response, await handle(parseRequest(route.request, await read()), { ...context, identity }));
		},
	};
}

export function workflow<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, EnrolledContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		async run(context, read) {
			const identity = await identify(context);
			const enrollment = await context.service.store.repository(identity.repositoryId);
			if (!enrollment || readiness(enrollment).kind === 'suspended') {
				throw forbidden('Repository is not enrolled or has been suspended');
			}
			return respond(
				route.response,
				await handle(parseRequest(route.request, await read()), { ...context, identity, enrollment }),
			);
		},
	};
}
