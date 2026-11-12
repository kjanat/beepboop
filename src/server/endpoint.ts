import type { APIRoute } from 'astro';
import { Cause, Effect } from 'effect';
import { logRecovered } from '@/automation/failure-log.ts';
import { failure } from '@/failure.ts';
import { bindings } from '@/server/bindings.ts';
import { knownOutage, outageLine, refreshOutage } from '@/server/github-status.ts';
import { dispatch } from '@/server/router.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = ({ request, locals }) =>
	serve(request, locals.cfContext ? work => locals.cfContext?.waitUntil(work) : undefined);

export function serve(request: Request, defer?: (work: Promise<void>) => void): Promise<Response> {
	return Effect.runPromise(
		Effect.gen(function*() {
			const path = new URL(request.url).pathname;
			const response = yield* bindings.pipe(
				Effect.flatMap(env => dispatch(request, env, defer)),
				Effect.catchCauseIf(
					cause => !Cause.hasInterrupts(cause),
					cause => Effect.sync(() => failure(request, Cause.squash(cause), cause)),
				),
			);
			if (!path.startsWith('/api/') && !path.startsWith('/auth/cli/')) return response;
			const refreshed = refreshOutage.pipe(logRecovered('github-status.failed'));
			if (defer) defer(Effect.runPromiseWith(yield* Effect.context())(refreshed));
			else yield* refreshed;
			const outage = knownOutage();
			if (!outage) return response;
			const annotated = new Response(response.body, response);
			annotated.headers.set('Beepboop-GitHub-Status', outageLine(outage));
			return annotated;
		}).pipe(
			Effect.withSpan('http.request'),
			Effect.annotateLogs({ method: request.method, path: new URL(request.url).pathname }),
		),
		{ signal: request.signal },
	);
}
