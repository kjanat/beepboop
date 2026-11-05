import { handle } from '@astrojs/cloudflare/handler';
import { Cause, Effect } from 'effect';
import { type AutomationBindings, AutomationService } from '@/automation/service.ts';
import { failure } from '@/failure.ts';
import { parseBindings } from '@/server/bindings.ts';

export { AutomationCoordinator } from '@/automation/coordinator.ts';
export { PublishBudget } from '@/automation/publish-budget.ts';
export { ReleaseWorkflow } from '@/automation/release-workflow';

export default {
	fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		return Effect.runPromise(
			Effect.tryPromise(() => handle(request, env, context)).pipe(
				Effect.catchCause(cause => Effect.sync(() => failure(request, Cause.squash(cause)))),
			),
		);
	},
	async scheduled(_event: ScheduledController, env: AutomationBindings): Promise<void> {
		await Effect.runPromise(
			parseBindings(env).pipe(Effect.flatMap(parsed => new AutomationService(parsed).scheduled())),
		);
	},
} satisfies ExportedHandler<Env>;
