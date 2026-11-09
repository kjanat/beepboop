import { Effect } from 'effect';
import type { z } from 'zod';
import type { WorkflowIdentity } from '@/automation/auth';
import { Authenticators, administrator, workflowIdentity } from '@/automation/auth';
import type { AutomationBindings, AutomationService } from '@/automation/service';
import type { RepositoryRecord } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, forbidden, securityKeyRequired } from '@/contract/errors';
import type { AnyRoute, Known, Route } from '@/contract/routes';
import { readiness } from '@/domain/repository';
import { fromSync } from '@/failure';

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
	run(context: Context, read: Effect.Effect<unknown, DomainError>): Effect.Effect<unknown, DomainError>;
}

type Reply<S extends z.ZodType> = Effect.Effect<Known<z.input<S>>, DomainError>;
type Handle<Q extends z.ZodType, S extends z.ZodType, C> = (input: z.output<Q>, context: C) => Reply<S>;
interface Elevated<S extends z.ZodType> {
	readonly commit: Reply<S>;
}

function respond<S extends z.ZodType>(schema: S, reply: Reply<S>): Reply<S> {
	return reply.pipe(Effect.tap(result => fromSync(() => schema.parse(result))));
}

function parsed<Q extends z.ZodType>(route: Route<Q, z.ZodType>, read: Effect.Effect<unknown, DomainError>) {
	return read.pipe(
		Effect.flatMap(raw => decodeRequest(route.request, raw).pipe(Effect.map(input => ({ raw, input })))),
	);
}

export function admin<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, AdminContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const actor = yield* administrator(context.request, context.env);
				const { input } = yield* parsed(route, read);
				return yield* respond(route.response, handle(input, { ...context, actor }));
			}),
	};
}

export function elevated<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	precheck: (input: z.output<Q>, context: AdminContext) => Effect.Effect<Elevated<S>, DomainError>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const actor = yield* administrator(context.request, context.env);
				const { raw, input } = yield* parsed(route, read);
				const proof = typeof raw === 'object' && raw !== null && 'proof' in raw ? raw.proof : undefined;
				const { commit } = yield* precheck(input, { ...context, actor });
				if (typeof proof !== 'string') return yield* forbidden(securityKeyRequired);
				yield* new Authenticators(context.env).consume(actor, proof);
				return yield* respond(route.response, commit);
			}),
	};
}

function identify(context: Context): Effect.Effect<WorkflowIdentity, DomainError> {
	return workflowIdentity(context.request, context.env.APPLICATION_ORIGIN, Number(context.env.OWNER_ID));
}

export function workflowToken<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, WorkflowContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const identity = yield* identify(context);
				const { input } = yield* parsed(route, read);
				return yield* respond(route.response, handle(input, { ...context, identity }));
			}),
	};
}

export function workflow<Q extends z.ZodType, S extends z.ZodType>(
	route: Route<Q, S>,
	handle: Handle<Q, S, EnrolledContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const identity = yield* identify(context);
				const enrollment = yield* context.service.store.repository(identity.repositoryId);
				if (!enrollment || readiness(enrollment).kind === 'suspended') {
					return yield* forbidden('Repository is not enrolled or has been suspended');
				}
				const { input } = yield* parsed(route, read);
				return yield* respond(route.response, handle(input, { ...context, identity, enrollment }));
			}),
	};
}
