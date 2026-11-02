import type { APIRoute } from 'astro';
import { AutomationService } from '@/automation/service.ts';
import { failure } from '@/failure.ts';
import { bindings } from '@/server/bindings.ts';

/** Preserve the Actions and webhook contracts while Astro owns HTTP routing. */
export const endpoint: APIRoute = async ({ request }) => {
	try {
		return await new AutomationService(bindings()).fetch(request);
	} catch (error) {
		return failure(request, error);
	}
};
