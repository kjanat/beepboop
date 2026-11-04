import { z } from 'zod';
import { legacyDiagnostic } from '@/contract/diagnostics';
import { type ApiError, DomainError, envelope, messageOf, statusOf } from '@/contract/errors';

interface Classified {
	problem: ApiError;
	message: string;
}

function classify(error: unknown, incident: string): Classified {
	if (error instanceof DomainError) return { problem: error.problem, message: error.message };
	if (error instanceof z.ZodError) {
		const problem: ApiError = {
			code: 'invalid',
			issues: error.issues.map(entry => ({
				path: entry.path.flatMap(part => typeof part === 'symbol' ? [] : [part]),
				message: entry.message,
			})),
		};
		return { problem, message: messageOf(problem) };
	}
	if (error instanceof SyntaxError) {
		const message = 'Invalid JSON in request or configuration';
		return { problem: { code: 'invalid', issues: [{ path: [], message }] }, message };
	}
	if (error instanceof Error && error.constructor === Error) {
		return {
			problem: { code: 'precondition', diagnostics: [legacyDiagnostic(error.message)] },
			message: error.message,
		};
	}
	const problem: ApiError = { code: 'internal', incident };
	return { problem, message: messageOf(problem) };
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
