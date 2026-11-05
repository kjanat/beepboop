import { Cause, Effect } from 'effect';
import { z } from 'zod';
import { legacyDiagnostic } from '@/contract/diagnostics';
import { type ApiError, DomainError, envelope, messageOf, statusOf } from '@/contract/errors';
import { InvalidPackageUrl } from '@/package-url';

interface Classified {
	problem: ApiError;
	message: string;
}

const d1Failure = /^D1_ERROR\b/;

export function classify(error: unknown, incident: string): Classified {
	if (error instanceof DomainError) return { problem: error.problem, message: error.message };
	if (error instanceof z.ZodError) {
		const problem: ApiError = { code: 'internal', incident };
		return { problem, message: messageOf(problem) };
	}
	if (error instanceof Error && d1Failure.test(error.message)) {
		const problem: ApiError = { code: 'upstream', service: 'd1', retryable: true };
		return { problem, message: messageOf(problem) };
	}
	if (error instanceof SyntaxError) {
		const message = 'Invalid JSON in request or configuration';
		return { problem: { code: 'invalid', issues: [{ path: [], message }] }, message };
	}
	if (error instanceof InvalidPackageUrl || (error instanceof Error && error.constructor === Error)) {
		return {
			problem: { code: 'precondition', diagnostics: [legacyDiagnostic(error.message)] },
			message: error.message,
		};
	}
	const problem: ApiError = { code: 'internal', incident };
	return { problem, message: messageOf(problem) };
}

export function retryable(error: unknown): boolean {
	return classify(error, '').problem.code === 'upstream';
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

function wantsDocument(request: Request, path: string): boolean {
	return request.method === 'GET' && !path.startsWith('/api/')
		&& (request.headers.get('accept') ?? '').includes('text/html');
}

export function failure(request: Request, error: unknown): Response {
	const incident = crypto.randomUUID();
	const path = new URL(request.url).pathname;
	const { problem, message } = classify(error, incident);
	const status = statusOf[problem.code];
	console.error(JSON.stringify({
		event: 'request.failed',
		method: request.method,
		path,
		status,
		code: problem.code,
		incident,
		error: error instanceof Error ? error.message : String(error),
	}));
	const headers = new Headers({ 'Cache-Control': 'no-store' });
	if (problem.code === 'method-not-allowed') headers.set('Allow', problem.allowed.join(', '));
	if (wantsDocument(request, path)) {
		headers.set('Content-Type', 'text/html; charset=utf-8');
		return new Response(
			`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status} · Beepboop</title></head><body><main><h1>Request failed</h1><p>${
				escapeHtml(message)
			}</p><p><a href="/">Return to the dashboard</a></p></main></body></html>`,
			{ status, headers },
		);
	}
	return Response.json(envelope(problem, message), { status, headers });
}

export function toDomainError(error: unknown): DomainError {
	if (error instanceof DomainError) return error;
	const { problem, message } = classify(error, crypto.randomUUID());
	const detail = error instanceof z.ZodError
		? z.prettifyError(error)
		: error instanceof Error
		? error.message
		: String(error);
	return new DomainError({ problem, message, detail });
}

export function fromPromise<A>(run: () => Promise<A>): Effect.Effect<A, DomainError> {
	return Effect.tryPromise({ try: run, catch: toDomainError });
}

export function fromSync<A>(run: () => A): Effect.Effect<A, DomainError> {
	return Effect.try({ try: run, catch: toDomainError });
}

export function fromJson(source: string): Effect.Effect<unknown, DomainError> {
	return fromSync((): unknown => JSON.parse(source));
}

export function recover<B, E>(handler: (error: DomainError) => Effect.Effect<B, E>) {
	return <A>(effect: Effect.Effect<A, DomainError>): Effect.Effect<A | B, E> =>
		effect.pipe(Effect.catchCause(cause => handler(toDomainError(Cause.squash(cause)))));
}
