export const env: Record<string, unknown> = {};

export class DurableObject<Env> {
	constructor(
		protected ctx: DurableObjectState,
		protected env: Env,
	) {}
}

export class WorkflowEntrypoint<Env> {
	constructor(
		protected ctx: ExecutionContext,
		protected env: Env,
	) {}
}

export class RpcTarget {}
