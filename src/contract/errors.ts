import type { Effect } from 'effect';
import { Data, Schema } from 'effect';
import { diagnostic } from '@/contract/diagnostics';
import { decodeWith } from '@/decode';
import type { Contract, Decoded } from '@/schema';
import { mutableArray, mutableStruct, schemaIssues } from '@/schema';

export const resources = [
	'repository',
	'execution',
	'credential',
	'grant',
	'route',
	'security-key',
	'release-event',
	'destination',
	'stream',
	'workflow',
] as const;
export type Resource = (typeof resources)[number];

export const conflictKinds = ['stale-plan', 'stale-revision', 'stale-version', 'override-digest', 'protocol'] as const;
export const services = ['github', 'registry', 'd1', 'oidc'] as const;

export const issue = mutableStruct({
	path: mutableArray(Schema.Union([Schema.String, Schema.Finite])),
	message: Schema.String,
});
export type Issue = Decoded<typeof issue>;

export const apiError = Schema.Union([
	mutableStruct({ code: Schema.Literal('unauthenticated') }),
	mutableStruct({ code: Schema.Literal('forbidden'), reason: Schema.String }),
	mutableStruct({
		code: Schema.Literal('not-found'),
		resource: Schema.Literals(resources),
		id: Schema.optional(Schema.String),
	}),
	mutableStruct({
		code: Schema.Literal('method-not-allowed'),
		allowed: mutableArray(Schema.Literals(['GET', 'POST'])),
	}),
	mutableStruct({ code: Schema.Literal('invalid'), issues: mutableArray(issue) }),
	mutableStruct({
		code: Schema.Literal('conflict'),
		kind: Schema.Literals(conflictKinds),
		expected: Schema.optional(Schema.String),
		actual: Schema.optional(Schema.String),
	}),
	mutableStruct({ code: Schema.Literal('precondition'), diagnostics: mutableArray(diagnostic) }),
	mutableStruct({
		code: Schema.Literal('upstream'),
		service: Schema.Literals(services),
		retryable: Schema.Literal(true),
	}),
	mutableStruct({ code: Schema.Literal('internal'), incident: Schema.String }),
]);
export type ApiError = Decoded<typeof apiError>;
export type ErrorCode = ApiError['code'];

export const statusOf = {
	unauthenticated: 401,
	forbidden: 403,
	'not-found': 404,
	'method-not-allowed': 405,
	invalid: 400,
	conflict: 409,
	precondition: 422,
	upstream: 502,
	internal: 500,
} as const satisfies Record<ErrorCode, number>;

export const errorEnvelope = mutableStruct({ error: Schema.String, problem: Schema.optional(apiError) });
export type ErrorEnvelope = Decoded<typeof errorEnvelope>;

const resourceLabels = {
	repository: 'Repository',
	execution: 'Execution',
	credential: 'Stored value',
	grant: 'Grant',
	route: 'Route',
	'security-key': 'Security key',
	'release-event': 'Release event',
	destination: 'Destination',
	stream: 'Release stream',
	workflow: 'Workflow',
} as const satisfies Record<Resource, string>;

export function messageOf(problem: ApiError): string {
	switch (problem.code) {
		case 'unauthenticated':
			return 'Administrator authentication required';
		case 'forbidden':
			return problem.reason;
		case 'not-found':
			return `${resourceLabels[problem.resource]} not found`;
		case 'method-not-allowed':
			return 'Method not allowed';
		case 'invalid':
			return problem.issues.map(entry =>
				entry.path.length ? `${entry.path.join('.')}: ${entry.message}` : entry.message
			)
				.join('; ') || 'Invalid request';
		case 'conflict':
			return `Request conflicts with current state (${problem.kind})`;
		case 'precondition':
			return problem.diagnostics.map(entry => entry.message).join('\n') || 'Precondition failed';
		case 'upstream':
			return `${problem.service} is unavailable; try again`;
		case 'internal':
			return `Internal error ${problem.incident}`;
	}
}

export class DomainError extends Data.TaggedError('DomainError')<{
	readonly problem: ApiError;
	readonly message: string;
	readonly detail?: string;
	readonly cause?: unknown;
}> {}

export function domainError(problem: ApiError, message = messageOf(problem)): DomainError {
	return new DomainError({ problem, message });
}

export function envelope(problem: ApiError, message = messageOf(problem)): ErrorEnvelope {
	return { error: message, problem };
}

export function notFound(resource: Resource, message?: string, id?: string): DomainError {
	return domainError({ code: 'not-found', resource, ...(id === undefined ? {} : { id }) }, message);
}
export const securityKeyRequired = 'This action needs a security-key touch; upgrade the beepboop CLI';
export function forbidden(reason: string): DomainError {
	return domainError({ code: 'forbidden', reason });
}
export function unauthenticated(message?: string): DomainError {
	return domainError({ code: 'unauthenticated' }, message);
}
export function conflict(kind: (typeof conflictKinds)[number], message: string): DomainError {
	return domainError({ code: 'conflict', kind }, message);
}
export function precondition(message: string): DomainError {
	return domainError({ code: 'precondition', diagnostics: [{ code: 'legacy', severity: 'blocking', message }] });
}
export function invalid(message: string, path: (string | number)[] = []): DomainError {
	return domainError({ code: 'invalid', issues: [{ path, message }] }, message);
}
export function upstream(service: (typeof services)[number], message: string): DomainError {
	return domainError({ code: 'upstream', service, retryable: true }, message);
}
export function invalidRequest(error: Schema.SchemaError): DomainError {
	return domainError({
		code: 'invalid',
		issues: schemaIssues(error).map(entry => ({
			path: entry.path.flatMap(part => typeof part === 'symbol' ? [] : [part]),
			message: entry.message,
		})),
	});
}
export function decodeRequest<S extends Contract>(schema: S, value: unknown): Effect.Effect<Decoded<S>, DomainError> {
	return decodeWith(schema, value, invalidRequest);
}
