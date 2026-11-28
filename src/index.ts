import { handle } from '@astrojs/cloudflare/handler';
import { Cause, Effect, Layer } from 'effect';
import type { AutomationBindings } from '@/automation/service.ts';
import { applicationLayer } from '@/automation/service.ts';
import { jsonLogging } from '@/kernel/logging/json-logging.ts';
import { parseBindings } from '@/server/bindings.ts';
import { failure } from '@/server/failure.ts';
import { ScheduledSweep } from '@/server/scheduled/sweep.ts';

export { AutomationCoordinator } from '@/server/durable/automation-coordinator.ts';
export { PublishBudget } from '@/server/durable/publish-budget.ts';
export { ReleaseWorkflow } from '@/server/durable/release-workflow.ts';

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
					ScheduledSweep.use(sweep => sweep.run).pipe(
						Effect.provide(ScheduledSweep.layer.pipe(Layer.provide(applicationLayer(parsed)))),
					)
				),
			),
		);
	},
} satisfies ExportedHandler<Env>;
