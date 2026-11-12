import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import { administrator, workflowIdentity } from '@/automation/auth';
import type { AutomationBindings, AutomationService } from '@/automation/service';
import type { RepositoryRecord } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { decodeRequest, forbidden, notFound, securityKeyRequired } from '@/contract/errors';
import type { AnyRoute, Known, Route } from '@/contract/routes';
import type { ReadyRepository } from '@/domain/repository';
import { readiness, requireReady } from '@/domain/repository';
import { fromSync } from '@/failure';
import type { Contract, Decoded, Encoded } from '@/schema';
import { decodeSync } from '@/schema';

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

export function storedRepository(
	service: AutomationService,
	id: number,
	missing: string,
): Effect.Effect<RepositoryRecord, DomainError> {
	return service.store.repository(id).pipe(
		Effect.filterOrFail(
			(repository): repository is RepositoryRecord => repository !== undefined,
			() => notFound('repository', missing, String(id)),
		),
	);
}

export function readyRepository(
	service: AutomationService,
	id: number,
	missing: string,
): Effect.Effect<ReadyRepository, DomainError> {
	return storedRepository(service, id, missing).pipe(Effect.flatMap(requireReady));
}

export interface Endpoint<R extends AnyRoute> {
	route: R;
	run(context: Context, read: Effect.Effect<unknown, DomainError>): Effect.Effect<unknown, DomainError>;
}

type Reply<S extends Contract> = Effect.Effect<Known<Encoded<S>>, DomainError>;
type Handle<Q extends Contract, S extends Contract, C> = (input: Decoded<Q>, context: C) => Reply<S>;
interface Elevated<S extends Contract> {
	readonly commit: Reply<S>;
}

function respond<S extends Contract>(schema: S, reply: Reply<S>): Reply<S> {
	return reply.pipe(Effect.tap(result => fromSync(() => decodeSync(schema, result))));
}

function parsed<Q extends Contract>(route: Route<Q, Contract>, read: Effect.Effect<unknown, DomainError>) {
	return read.pipe(
		Effect.flatMap(raw => decodeRequest(route.request, raw).pipe(Effect.map(input => ({ raw, input })))),
	);
}

export function admin<Q extends Contract, S extends Contract>(
	route: Route<Q, S>,
	handle: Handle<Q, S, AdminContext>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const actor = yield* administrator(context.request, context.env, context.service.authentication);
				const { input } = yield* parsed(route, read);
				return yield* respond(route.response, handle(input, { ...context, actor }));
			}),
	};
}

export function elevated<Q extends Contract, S extends Contract>(
	route: Route<Q, S>,
	precheck: (input: Decoded<Q>, context: AdminContext) => Effect.Effect<Elevated<S>, DomainError>,
): Endpoint<Route<Q, S>> {
	return {
		route,
		run: (context, read) =>
			Effect.gen(function*() {
				const actor = yield* administrator(context.request, context.env, context.service.authentication);
				const { raw, input } = yield* parsed(route, read);
				const proof = typeof raw === 'object' && raw !== null && 'proof' in raw ? raw.proof : undefined;
				const { commit } = yield* precheck(input, { ...context, actor });
				if (typeof proof !== 'string') return yield* forbidden(securityKeyRequired);
				yield* context.service.authentication.authenticators.consume(actor, proof);
				return yield* respond(route.response, commit);
			}),
	};
}

function identify(context: Context): Effect.Effect<WorkflowIdentity, DomainError> {
	return workflowIdentity(
		context.request,
		context.env.APPLICATION_ORIGIN,
		Number(context.env.OWNER_ID),
		context.service.authentication.workflowKeys,
	);
}

export function workflowToken<Q extends Contract, S extends Contract>(
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

export function workflow<Q extends Contract, S extends Contract>(
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
