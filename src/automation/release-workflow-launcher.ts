import { Context, Effect, Layer } from 'effect';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { ReleaseWorkflowParams } from '@/server/durable/release-workflow.ts';

export interface ReleaseWorkflowInstance {
	readonly status: Effect.Effect<InstanceStatus['status'], DomainError>;
	readonly notify: (type: string) => Effect.Effect<void, DomainError>;
	readonly restart: Effect.Effect<void, DomainError>;
}

export class ReleaseWorkflowLauncher extends Context.Service<ReleaseWorkflowLauncher, {
	readonly create: (id: string, params: ReleaseWorkflowParams) => Effect.Effect<void, DomainError>;
	readonly get: (id: string) => Effect.Effect<ReleaseWorkflowInstance, DomainError>;
}>()('beepboop/automation/ReleaseWorkflowLauncher') {
	static layer(binding: () => Workflow<ReleaseWorkflowParams>): Layer.Layer<ReleaseWorkflowLauncher> {
		return Layer.succeed(ReleaseWorkflowLauncher, {
			create: (id, params) => fromPromise(() => binding().create({ id, params })).pipe(Effect.asVoid),
			get: id =>
				fromPromise(() => binding().get(id)).pipe(Effect.map((instance): ReleaseWorkflowInstance => ({
					status: fromPromise(() => instance.status()).pipe(Effect.map(status => status.status)),
					notify: type => fromPromise(() => instance.sendEvent({ type, payload: {} })),
					restart: fromPromise(() => instance.restart()),
				}))),
		});
	}
}
