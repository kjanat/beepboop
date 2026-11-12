import type { APIRoute } from 'astro';
import type { Layer } from 'effect';
import { Cause, Effect } from 'effect';
import { logRecovered } from '@/automation/failure-log.ts';
import { Automation, applicationLayer } from '@/automation/service.ts';
import type { DomainError } from '@/contract/errors';
import { failure } from '@/failure.ts';
import { jsonLogging } from '@/runtime/logging';
import { bindings } from '@/server/bindings.ts';
import { knownOutage, outageLine, refreshOutage } from '@/server/github-status.ts';
import { dispatch } from '@/server/router.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = ({ request, locals }) =>
	serve(request, locals.cfContext ? work => locals.cfContext?.waitUntil(work) : undefined);

export function serve(
	request: Request,
	defer?: (work: Promise<void>) => void,
	application?: Layer.Layer<Automation, DomainError>,
): Promise<Response> {
	const work = application
		? handleRequest(request).pipe(Effect.provide(application))
		: bindings.pipe(Effect.flatMap(env => handleRequest(request).pipe(Effect.provide(applicationLayer(env, defer)))));
	return Effect.runPromise(
		work.pipe(
			Effect.catchCauseIf(cause => !Cause.hasInterrupts(cause), cause => failure(request, Cause.squash(cause), cause)),
			Effect.provide(jsonLogging),
		),
		{ signal: request.signal },
	);
}

export function handleRequest(request: Request): Effect.Effect<Response, DomainError, Automation> {
	return Effect.gen(function*() {
		const service = yield* Automation;
		const path = new URL(request.url).pathname;
		const response = yield* dispatch(request).pipe(
			Effect.catchCauseIf(cause => !Cause.hasInterrupts(cause), cause => failure(request, Cause.squash(cause), cause)),
		);
		if (!path.startsWith('/api/') && !path.startsWith('/auth/cli/')) return response;
		const refreshed = refreshOutage.pipe(logRecovered('github-status.failed'));
		if (service.defer) service.defer(Effect.runPromiseWith(yield* Effect.context<Automation>())(refreshed));
		else yield* refreshed;
		const outage = knownOutage();
		if (!outage) return response;
		const annotated = new Response(response.body, response);
		annotated.headers.set('Beepboop-GitHub-Status', outageLine(outage));
		return annotated;
	}).pipe(
		Effect.withSpan('http.request'),
		Effect.annotateLogs({ method: request.method, path: new URL(request.url).pathname }),
	);
}
