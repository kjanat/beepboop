import { handle } from '@astrojs/cloudflare/handler';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import { failure } from '@/failure.ts';

export { AutomationCoordinator } from '@/automation/coordinator.ts';
export { PublishBudget } from '@/automation/publish-budget.ts';
export { ReleaseWorkflow } from '@/automation/release-workflow';

export default {
	async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		try {
			return await handle(request, env, context);
		} catch (error) {
			return failure(request, error);
		}
	},
	async scheduled(_event: ScheduledController, env: AutomationBindings): Promise<void> {
		await new AutomationService(env).scheduled();
	},
} satisfies ExportedHandler<Env>;
