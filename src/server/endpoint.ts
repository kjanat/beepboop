import type { APIRoute } from 'astro';
import { Cause, Effect } from 'effect';
import { decodeError } from '@/automation/store.ts';
import { failure, recover } from '@/failure.ts';
import { bindings } from '@/server/bindings.ts';
import { knownOutage, outageLine, refreshOutage } from '@/server/github-status.ts';
import { dispatch } from '@/server/router.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = ({ request, locals }) =>
	serve(request, locals.cfContext ? work => locals.cfContext?.waitUntil(work) : undefined);

export function serve(request: Request, defer?: (work: Promise<void>) => void): Promise<Response> {
	return Effect.runPromise(Effect.gen(function*() {
		const path = new URL(request.url).pathname;
		const response = yield* Effect.suspend(() => dispatch(request, bindings())).pipe(
			Effect.catchCause(cause => Effect.sync(() => failure(request, Cause.squash(cause)))),
		);
		if (!path.startsWith('/api/') && !path.startsWith('/auth/cli/')) return response;
		const refreshed = refreshOutage.pipe(
			recover(error =>
				Effect.sync(() => console.error(JSON.stringify({ event: 'github-status.failed', error: decodeError(error) })))
			),
		);
		if (defer) defer(Effect.runPromiseWith(yield* Effect.context())(refreshed));
		else yield* refreshed;
		const outage = knownOutage();
		if (!outage) return response;
		const annotated = new Response(response.body, response);
		annotated.headers.set('Beepboop-GitHub-Status', outageLine(outage));
		return annotated;
	}));
}
