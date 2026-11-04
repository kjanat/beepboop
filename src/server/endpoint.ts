import type { APIRoute } from 'astro';
import { failure } from '@/failure.ts';
import { bindings } from '@/server/bindings.ts';
import { knownOutage, outageLine, refreshOutage } from '@/server/github-status.ts';
import { dispatch } from '@/server/router.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = ({ request, locals }) =>
	serve(request, locals.cfContext ? work => locals.cfContext?.waitUntil(work) : undefined);

export async function serve(request: Request, defer?: (work: Promise<void>) => void): Promise<Response> {
	const path = new URL(request.url).pathname;
	const response = await Promise.resolve().then(() => dispatch(request, bindings())).catch(error =>
		failure(request, error)
	);
	if (!path.startsWith('/api/') && !path.startsWith('/auth/cli/')) return response;
	const refreshed = refreshOutage().catch(error =>
		console.error(JSON.stringify({ event: 'github-status.failed', error: String(error) }))
	);
	if (defer) defer(refreshed);
	else await refreshed;
	const outage = knownOutage();
	if (!outage) return response;
	const annotated = new Response(response.body, response);
	annotated.headers.set('Beepboop-GitHub-Status', outageLine(outage));
	return annotated;
}
