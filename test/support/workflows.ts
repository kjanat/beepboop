import { setSystemTime } from 'bun:test';
import type {
	WorkflowDelayFunction,
	WorkflowEvent,
	WorkflowSleepDuration,
	WorkflowStep,
	WorkflowStepConfig,
	WorkflowStepContext,
	WorkflowStepEvent,
	WorkflowStepRollbackOptions,
	WorkflowTimeoutDuration,
} from 'cloudflare:workers';
import { cloned } from '@root/test/support/do-storage.ts';
import type { StorageTrace } from '@root/test/support/storage-trace.ts';

export type WorkflowRunner<P> = (event: WorkflowEvent<P>, step: WorkflowStep) => Promise<unknown>;

export interface WorkflowStepRecord {
	kind: 'do' | 'throw' | 'sleep' | 'wait';
	name: string;
	value: unknown;
}

interface Waiter {
	type: string;
	resolve: (event: WorkflowStepEvent<unknown>) => void;
	reject: (error: Error) => void;
}

export interface WorkflowRecord<P> {
	id: string;
	params: P | undefined;
	status: InstanceStatus['status'];
	events: string[];
	restarts: number;
	queued: string[];
	waiters: Waiter[];
	active: number;
	generation: number;
	steps: WorkflowStepRecord[];
	run?: Promise<void>;
}

type StepCallback<T> = (ctx: WorkflowStepContext) => Promise<T>;
type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

const retryLimit = 5;
const retryDelay = 10_000;

function duration(value: WorkflowSleepDuration): number {
	if (typeof value === 'number') return value;
	throw new Error(`The fake workflow step takes milliseconds, not ${value}`);
}

function timedOut(type: string): Error {
	return Object.assign(new Error(`Timed out waiting for ${type}`), { name: 'WorkflowTimeoutError' });
}

function halted(): Promise<never> {
	return new Promise(() => undefined);
}

class FakeStep<P> implements WorkflowStep {
	private readonly counts = new Map<string, number>();
	private readonly generation: number;
	constructor(
		private readonly record: WorkflowRecord<P>,
		private readonly trace: StorageTrace | undefined,
	) {
		this.generation = record.generation;
	}
	private get stopped(): boolean {
		return this.generation !== this.record.generation;
	}
	private log(kind: WorkflowStepRecord['kind'], name: string, value: unknown): void {
		this.record.steps.push({ kind, name, value: cloned(value) });
		this.trace?.write(`ReleaseWorkflow:${this.record.id}`, kind, name, value);
	}
	do<T extends Rpc.Serializable<T>>(
		name: string,
		callback: (ctx: WorkflowStepContext) => Promise<T>,
		rollbackOptions?: WorkflowStepRollbackOptions<T>,
	): Promise<T>;
	do<T extends Rpc.Serializable<T>>(
		name: string,
		config: WorkflowStepConfig,
		callback: (ctx: WorkflowStepContext<WorkflowDelayFunction>) => Promise<T>,
		rollbackOptions?: WorkflowStepRollbackOptions<T, WorkflowDelayFunction>,
	): Promise<T>;
	do<T extends Rpc.Serializable<T>>(
		name: string,
		config: WorkflowStepConfig,
		callback: (ctx: WorkflowStepContext) => Promise<T>,
		rollbackOptions?: WorkflowStepRollbackOptions<T>,
	): Promise<T>;
	async do<T>(
		name: string,
		first: WorkflowStepConfig | StepCallback<T>,
		second?: StepCallback<T> | WorkflowStepRollbackOptions<T, never>,
	): Promise<T> {
		if (typeof first !== 'function' || second !== undefined) {
			throw new Error(`Step ${name} passes a config or rollback the fake does not model`);
		}
		if (this.stopped) return halted();
		const count = (this.counts.get(name) ?? 0) + 1;
		this.counts.set(name, count);
		const config: WorkflowStepContext['config'] = {
			retries: { limit: retryLimit, delay: retryDelay, backoff: 'exponential' },
		};
		this.record.active++;
		try {
			for (let attempt = 1;; attempt++) {
				const outcome = await first({ step: { name, count }, attempt, config }).then(
					(value): Attempt<T> => ({ ok: true, value }),
					(error: unknown): Attempt<T> => ({ ok: false, error }),
				);
				if (this.stopped) return halted();
				if (outcome.ok) {
					this.log('do', name, outcome.value);
					return outcome.value;
				}
				if (attempt > retryLimit) {
					this.log('throw', name, outcome.error);
					throw outcome.error;
				}
				setSystemTime(new Date(Date.now() + retryDelay * 2 ** (attempt - 1)));
			}
		} finally {
			if (!this.stopped) this.record.active--;
		}
	}
	sleep = async (name: string, value: WorkflowSleepDuration): Promise<void> => {
		const milliseconds = duration(value);
		if (this.stopped) return halted();
		this.log('sleep', name, milliseconds);
		setSystemTime(new Date(Date.now() + milliseconds));
	};
	sleepUntil = async (): Promise<void> => {
		throw new Error('WorkflowStep.sleepUntil is not used by Beepboop');
	};
	waitForEvent<T extends Rpc.Serializable<T>>(
		name: string,
		options: { type: string; timeout?: WorkflowTimeoutDuration | number },
	): Promise<WorkflowStepEvent<T>>;
	async waitForEvent(
		name: string,
		options: { type: string; timeout?: WorkflowTimeoutDuration | number },
	): Promise<WorkflowStepEvent<unknown>> {
		const { type, timeout } = options;
		if (this.stopped) return halted();
		this.log('wait', name, [type, timeout]);
		const index = this.record.queued.indexOf(type);
		if (index >= 0) {
			this.record.queued.splice(index, 1);
			return { payload: {}, timestamp: new Date(), type };
		}
		return new Promise((resolve, reject) => {
			this.record.waiters.push({ type, resolve, reject });
		});
	}
}

export class FakeWorkflow<P> {
	readonly instances = new Map<string, WorkflowRecord<P>>();
	private runner: WorkflowRunner<P> | undefined;
	constructor(private readonly trace?: StorageTrace) {}
	runs(runner: WorkflowRunner<P>): void {
		this.runner = runner;
	}
	private start(record: WorkflowRecord<P>): void {
		const runner = this.runner;
		if (!runner) return;
		const params = record.params;
		if (params === undefined) throw new Error(`Workflow ${record.id} has no params`);
		const event: WorkflowEvent<P> = {
			payload: params,
			timestamp: new Date(),
			instanceId: record.id,
			workflowName: 'release',
		};
		const generation = record.generation;
		const ended = (status: 'complete' | 'errored') => () => {
			if (record.generation === generation && record.status === 'running') record.status = status;
		};
		const step = new FakeStep(record, this.trace);
		record.run = Promise.resolve().then(() => runner(event, step)).then(ended('complete'), ended('errored'));
	}
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
				this.abandon(record);
				this.start(record);
			},
			delete: async () => {
				this.instances.delete(record.id);
			},
			status: async () => ({ status: record.status }),
			sendEvent: async ({ type }) => {
				record.events.push(type);
				const index = record.waiters.findIndex(waiter => waiter.type === type);
				const [waiter] = index >= 0 ? record.waiters.splice(index, 1) : [];
				if (waiter) waiter.resolve({ payload: {}, timestamp: new Date(), type });
				else record.queued.push(type);
			},
			subscribe: async () => {
				throw new Error('WorkflowInstance.subscribe is not used by Beepboop');
			},
		};
	}
	private abandon(record: WorkflowRecord<P>): void {
		record.generation++;
		record.waiters.splice(0);
		record.queued.splice(0);
		record.active = 0;
	}
	private record(id: string): WorkflowRecord<P> {
		const record = this.instances.get(id);
		if (!record) throw new Error(`instance.not_found: ${id}`);
		return record;
	}
	async get(id: string): Promise<WorkflowInstance> {
		return this.handle(this.record(id));
	}
	async create(options?: WorkflowInstanceCreateOptions<P>): Promise<WorkflowInstance> {
		const id = options?.id ?? crypto.randomUUID();
		if (this.instances.has(id)) throw new Error(`instance.already_exists: ${id}`);
		const record: WorkflowRecord<P> = {
			id,
			params: options?.params,
			status: 'running',
			events: [],
			restarts: 0,
			queued: [],
			waiters: [],
			active: 0,
			generation: 0,
			steps: [],
		};
		this.instances.set(id, record);
		this.start(record);
		return this.handle(record);
	}
	expire(id: string): void {
		const record = this.record(id);
		for (const waiter of record.waiters.splice(0)) waiter.reject(timedOut(waiter.type));
	}
	dispose(): void {
		for (const record of this.instances.values()) this.abandon(record);
	}
	async idle(id: string, limit = 2_000): Promise<WorkflowRecord<P>> {
		const record = this.record(id);
		let finished = false;
		void record.run?.then(() => {
			finished = true;
		});
		for (let tick = 0, quiet = 0; tick < limit; tick++) {
			await new Promise(resolve => setTimeout(resolve, 0));
			const waiting = record.active === 0 && record.waiters.length > 0;
			quiet = finished || waiting || record.status !== 'running' ? quiet + 1 : 0;
			if (quiet >= 5) return record;
		}
		throw new Error(`Workflow ${id} kept working for ${limit} ticks`);
	}
	async createBatch(): Promise<never> {
		throw new Error('Workflow.createBatch is not used by Beepboop');
	}
	async deleteBatch(): Promise<never> {
		throw new Error('Workflow.deleteBatch is not used by Beepboop');
	}
}
