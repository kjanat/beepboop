import { handle } from '@astrojs/cloudflare/handler';
import { Cause, Effect } from 'effect';
import type { AutomationBindings } from '@/automation/service.ts';
import { applicationLayer, withAutomation } from '@/automation/service.ts';
import { failure } from '@/failure.ts';
import { jsonLogging } from '@/runtime/logging';
import { parseBindings } from '@/server/bindings.ts';

export { AutomationCoordinator } from '@/automation/coordinator.ts';
export { PublishBudget } from '@/automation/publish-budget.ts';
export { ReleaseWorkflow } from '@/automation/release-workflow';

export default {
	fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
		return Effect.runPromise(
			Effect.tryPromise(() => handle(request, env, context)).pipe(
				Effect.catchCauseIf(
					cause => !Cause.hasInterrupts(cause),
					cause => failure(request, Cause.squash(cause), cause),
				),
				Effect.provide(jsonLogging),
			),
			{ signal: request.signal },
		);
	},
	async scheduled(_event: ScheduledController, env: AutomationBindings): Promise<void> {
		await Effect.runPromise(
			parseBindings(env).pipe(
				Effect.flatMap(parsed =>
					withAutomation(service => service.scheduled).pipe(Effect.provide(applicationLayer(parsed)))
				),
			),
		);
	},
} satisfies ExportedHandler<Env>;
