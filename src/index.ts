import { type AutomationBindings, AutomationService } from './automation/service.ts';
import { failure } from './failure.ts';

export { AutomationCoordinator } from './automation/coordinator.ts';
export { VermonEvents } from './automation/vermon.ts';

export default {
	async fetch(request: Request, env: AutomationBindings): Promise<Response> {
		try {
			const response = await new AutomationService(env).fetch(request);
			const headers = new Headers(response.headers);
			headers.set('Cache-Control', 'no-store');
			headers.set('X-Content-Type-Options', 'nosniff');
			return new Response(response.body, { status: response.status, headers });
		} catch (error) {
			return failure(request, error);
		}
	},
	async scheduled(_event: ScheduledController, env: AutomationBindings): Promise<void> {
		await new AutomationService(env).scheduled();
	},
} satisfies ExportedHandler<AutomationBindings>;
