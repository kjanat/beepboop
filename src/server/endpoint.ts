import type { APIRoute } from 'astro';
import { AutomationService } from '@/automation/service.ts';
import { failure } from '@/failure.ts';
import { bindings } from '@/server/bindings.ts';
import { githubOutage, outageLine } from '@/server/github-status.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = async ({ request }) => {
	const path = new URL(request.url).pathname;
	const [response, outage] = await Promise.all([
		new AutomationService(bindings()).fetch(request).catch(error => failure(request, error)),
		path.startsWith('/api/') || path.startsWith('/auth/cli/') ? githubOutage() : undefined,
	]);
	if (!outage) return response;
	const annotated = new Response(response.body, response);
	annotated.headers.set('Beepboop-GitHub-Status', outageLine(outage));
	return annotated;
};
