import { Cause, Effect } from 'effect';
import { classify } from '@/kernel/errors/classify.ts';
import { envelope, messageOf, statusOf } from '@/kernel/errors/domain-error.ts';

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
