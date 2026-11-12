import { Cause, Effect, Result, Schema } from 'effect';
import { legacyDiagnostic } from '@/contract/diagnostics';
import type { ApiError } from '@/contract/errors';
import { DomainError, envelope, messageOf, statusOf } from '@/contract/errors';
import { InvalidPackageUrl } from '@/package-url';

interface Classified {
	problem: ApiError;
	message: string;
}

const d1Failure = /^D1_ERROR\b/;

export function classify(error: unknown, incident: string): Classified {
	if (error instanceof DomainError) return { problem: error.problem, message: error.message };
	if (error instanceof Schema.SchemaError) {
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
	if (error instanceof InvalidPackageUrl) {
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

export interface ErrorPage {
	title: string;
	heading: string;
	message: string;
	link: { href: string; text: string };
}

export function errorPage({ title, heading, message, link }: ErrorPage): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Beepboop</title></head><body><main><h1>${heading}</h1><p>${
		escapeHtml(message)
	}</p><p><a href="${link.href}">${link.text}</a></p></main></body></html>`;
}

function wantsDocument(request: Request, path: string): boolean {
	return request.method === 'GET' && !path.startsWith('/api/')
		&& (request.headers.get('accept') ?? '').includes('text/html');
}

export function failure(request: Request, error: unknown, cause?: Cause.Cause<unknown>): Effect.Effect<Response> {
	return Effect.gen(function*() {
		const incident = crypto.randomUUID();
		const path = new URL(request.url).pathname;
		const { problem, message } = cause && Cause.hasDies(cause)
			? { problem: { code: 'internal', incident } as const, message: messageOf({ code: 'internal', incident }) }
			: classify(error, incident);
		const status = statusOf[problem.code];
		yield* Effect.logError('request.failed', cause ?? Cause.fail(error)).pipe(Effect.annotateLogs({
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
				errorPage({
					title: String(status),
					heading: 'Request failed',
					message,
					link: { href: '/', text: 'Return to the dashboard' },
				}),
				{ status, headers },
			);
		}
		return Response.json(envelope(problem, message), { status, headers });
	});
}

export function toDomainError(error: unknown): DomainError {
	if (error instanceof DomainError) return error;
	const { problem, message } = classify(error, crypto.randomUUID());
	const detail = error instanceof Schema.SchemaError
		? error.message
		: error instanceof Error
		? error.message
		: String(error);
	return new DomainError({ problem, message, detail, cause: error });
}

export function fromPromise<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, DomainError> {
	return Effect.tryPromise({ try: run, catch: toDomainError });
}

export function fromSync<A>(run: () => A): Effect.Effect<A, DomainError> {
	return Effect.suspend(() => Result.match(Result.try(run), {
		onSuccess: Effect.succeed,
		onFailure: error =>
			error instanceof DomainError || error instanceof Schema.SchemaError || error instanceof SyntaxError
				|| error instanceof InvalidPackageUrl
				? Effect.fail(toDomainError(error))
				: Effect.die(error),
	}));
}

export function fromJson(source: string): Effect.Effect<unknown, DomainError> {
	return fromSync((): unknown => JSON.parse(source));
}

export function recover<B, E, R2>(handler: (error: DomainError) => Effect.Effect<B, E, R2>) {
	return <A, R>(effect: Effect.Effect<A, DomainError, R>): Effect.Effect<A | B, E, R | R2> =>
		effect.pipe(Effect.catch(handler));
}
