import { z } from 'zod';
import { diagnostic } from '@/contract/diagnostics';

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

export const issue = z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() });
export type Issue = z.output<typeof issue>;

export const apiError = z.discriminatedUnion('code', [
	z.object({ code: z.literal('unauthenticated') }),
	z.object({ code: z.literal('forbidden'), reason: z.string() }),
	z.object({ code: z.literal('not-found'), resource: z.enum(resources), id: z.string().optional() }),
	z.object({ code: z.literal('method-not-allowed'), allowed: z.array(z.enum(['GET', 'POST'])) }),
	z.object({ code: z.literal('invalid'), issues: z.array(issue) }),
	z.object({
		code: z.literal('conflict'),
		kind: z.enum(conflictKinds),
		expected: z.string().optional(),
		actual: z.string().optional(),
	}),
	z.object({ code: z.literal('precondition'), diagnostics: z.array(diagnostic) }),
	z.object({ code: z.literal('upstream'), service: z.enum(services), retryable: z.literal(true) }),
	z.object({ code: z.literal('internal'), incident: z.string() }),
]);
export type ApiError = z.output<typeof apiError>;
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

export const errorEnvelope = z.object({ error: z.string(), problem: apiError.optional() });
export type ErrorEnvelope = z.output<typeof errorEnvelope>;

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

export class DomainError extends Error {
	constructor(readonly problem: ApiError, message = messageOf(problem)) {
		super(message);
		this.name = 'DomainError';
	}
}

export function envelope(problem: ApiError, message = messageOf(problem)): ErrorEnvelope {
	return { error: message, problem };
}

export function notFound(resource: Resource, message?: string, id?: string): DomainError {
	return new DomainError({ code: 'not-found', resource, ...(id === undefined ? {} : { id }) }, message);
}
export function forbidden(reason: string): DomainError {
	return new DomainError({ code: 'forbidden', reason });
}
export function unauthenticated(message?: string): DomainError {
	return new DomainError({ code: 'unauthenticated' }, message);
}
export function conflict(kind: (typeof conflictKinds)[number], message: string): DomainError {
	return new DomainError({ code: 'conflict', kind }, message);
}
export function precondition(message: string): DomainError {
	return new DomainError({ code: 'precondition', diagnostics: [{ code: 'legacy', severity: 'blocking', message }] });
}
export function invalid(message: string, path: (string | number)[] = []): DomainError {
	return new DomainError({ code: 'invalid', issues: [{ path, message }] }, message);
}
