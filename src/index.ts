import { type AutomationBindings, AutomationService } from './automation/service.ts';

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
			return Response.json(
				{
					error: error instanceof SyntaxError
						? 'Invalid JSON in request or configuration'
						: error instanceof Error && !/token|secret|credential/i.test(error.message)
						? error.message
						: 'Request denied or unavailable',
				},
				{ status: 400, headers: { 'Cache-Control': 'no-store' } },
			);
		}
	},
	async scheduled(_event: ScheduledController, env: AutomationBindings): Promise<void> {
		await new AutomationService(env).scheduled();
	},
} satisfies ExportedHandler<AutomationBindings>;
