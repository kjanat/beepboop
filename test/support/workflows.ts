export interface WorkflowRecord<P> {
	id: string;
	params: P | undefined;
	status: InstanceStatus['status'];
	events: string[];
	restarts: number;
}

export class FakeWorkflow<P> {
	readonly instances = new Map<string, WorkflowRecord<P>>();
	private handle(record: WorkflowRecord<P>): WorkflowInstance {
		return {
			id: record.id,
			pause: async () => {
				record.status = 'paused';
			},
			resume: async () => {
				record.status = 'running';
			},
			terminate: async () => {
				record.status = 'terminated';
			},
			restart: async () => {
				record.restarts++;
				record.status = 'running';
			},
			delete: async () => {
				this.instances.delete(record.id);
			},
			status: async () => ({ status: record.status }),
			sendEvent: async ({ type }) => {
				record.events.push(type);
			},
			subscribe: async () => {
				throw new Error('WorkflowInstance.subscribe is not used by Beepboop');
			},
		};
	}
	async get(id: string): Promise<WorkflowInstance> {
		const record = this.instances.get(id);
		if (!record) throw new Error(`instance.not_found: ${id}`);
		return this.handle(record);
	}
	async create(options?: WorkflowInstanceCreateOptions<P>): Promise<WorkflowInstance> {
		const id = options?.id ?? crypto.randomUUID();
		if (this.instances.has(id)) throw new Error(`instance.already_exists: ${id}`);
		const record: WorkflowRecord<P> = { id, params: options?.params, status: 'running', events: [], restarts: 0 };
		this.instances.set(id, record);
		return this.handle(record);
	}
	async createBatch(): Promise<never> {
		throw new Error('Workflow.createBatch is not used by Beepboop');
	}
	async deleteBatch(): Promise<never> {
		throw new Error('Workflow.deleteBatch is not used by Beepboop');
	}
}
