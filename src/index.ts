import { handle } from '@astrojs/cloudflare/handler';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import { failure } from '@/failure.ts';

export { AutomationCoordinator } from '@/automation/coordinator.ts';
export { ReleaseWorkflow } from '@/automation/release-workflow';

export default {
	async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		try {
			const response = await handle(request, env, context);
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
} satisfies ExportedHandler<Env>;
