const background = new Set<Promise<unknown>>();
const backgroundFailures: unknown[] = [];
export function deferBackground(work: Promise<unknown>): void {
	background.add(work);
	void work.then(
		() => background.delete(work),
		error => {
			backgroundFailures.push(error);
			background.delete(work);
		},
	);
}
export async function drainBackground(): Promise<void> {
	while (background.size) await Promise.allSettled([...background]);
	if (backgroundFailures.length) throw new AggregateError(backgroundFailures.splice(0), 'Background work failed');
}

import { deserialize, serialize } from 'bun:jsc';

export interface StorageOperation {
	kind: 'get' | 'put' | 'delete' | 'list' | 'alarm';
	keys: number;
}

function unsupported(name: string): never {
	throw new Error(`DurableObjectStorage.${name} is not used by Beepboop`);
}

export function cloned(value: unknown): ReturnType<typeof deserialize> {
	return value === undefined ? undefined : deserialize(serialize(value));
}

class Entries {
	constructor(
		readonly data: Map<string, SharedArrayBuffer>,
		readonly operations: StorageOperation[],
	) {}
	read(key: string): ReturnType<typeof deserialize> {
		const value = this.data.get(key);
		return value === undefined ? undefined : deserialize(value);
	}
	write(key: string, value: unknown): void {
		if (value === undefined) throw new TypeError('DurableObjectStorage cannot store undefined');
		this.data.set(key, serialize(value));
	}
	list(options: DurableObjectListOptions = {}): Map<string, ReturnType<typeof deserialize>> {
		let keys = [...this.data.keys()].sort().filter(key =>
			(options.prefix === undefined || key.startsWith(options.prefix))
			&& (options.start === undefined || key >= options.start)
			&& (options.startAfter === undefined || key > options.startAfter)
			&& (options.end === undefined || key < options.end)
		);
		if (options.reverse) keys = keys.reverse();
		if (options.limit !== undefined) keys = keys.slice(0, options.limit);
		this.operations.push({ kind: 'list', keys: keys.length });
		return new Map(keys.map(key => [key, this.read(key)]));
	}
}

export class MemoryStorage {
	readonly data = new Map<string, SharedArrayBuffer>();
	readonly operations: StorageOperation[] = [];
	alarm: number | null = null;
	private readonly entries = new Entries(this.data, this.operations);

	get<T = unknown>(key: string, options?: DurableObjectGetOptions): Promise<T | undefined>;
	get<T = unknown>(keys: string[], options?: DurableObjectGetOptions): Promise<Map<string, T>>;
	async get(key: string | string[]): Promise<unknown> {
		if (Array.isArray(key)) {
			this.operations.push({ kind: 'get', keys: key.length });
			return new Map(key.flatMap(name => this.data.has(name) ? [[name, this.entries.read(name)]] : []));
		}
		this.operations.push({ kind: 'get', keys: 1 });
		return this.entries.read(key);
	}
	async list<T = unknown>(options?: DurableObjectListOptions): Promise<Map<string, T>> {
		return this.entries.list(options);
	}
	put<T>(key: string, value: T, options?: DurableObjectPutOptions): Promise<void>;
	put<T>(entries: Record<string, T>, options?: DurableObjectPutOptions): Promise<void>;
	async put(key: string | Record<string, unknown>, value?: unknown): Promise<void> {
		if (typeof key === 'string') {
			this.operations.push({ kind: 'put', keys: 1 });
			this.entries.write(key, value);
			return;
		}
		const entries = Object.entries(key);
		if (entries.length > 128) throw new RangeError('DurableObjectStorage.put accepts at most 128 keys');
		this.operations.push({ kind: 'put', keys: entries.length });
		for (const [name, entry] of entries) this.entries.write(name, entry);
	}
	delete(key: string, options?: DurableObjectPutOptions): Promise<boolean>;
	delete(keys: string[], options?: DurableObjectPutOptions): Promise<number>;
	async delete(key: string | string[]): Promise<boolean | number> {
		if (Array.isArray(key)) {
			this.operations.push({ kind: 'delete', keys: key.length });
			return key.filter(name => this.data.delete(name)).length;
		}
		this.operations.push({ kind: 'delete', keys: 1 });
		return this.data.delete(key);
	}
	async deleteAll(): Promise<void> {
		this.data.clear();
		this.alarm = null;
	}
	async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
		const snapshot = new Map(this.data);
		const alarm = this.alarm;
		let rolledBack = false;
		const restore = () => {
			this.data.clear();
			for (const [key, value] of snapshot) this.data.set(key, value);
			this.alarm = alarm;
		};
		const storage = this;
		const transaction: DurableObjectTransaction = {
			get: storage.get.bind(storage),
			list: storage.list.bind(storage),
			put: storage.put.bind(storage),
			delete: storage.delete.bind(storage),
			rollback() {
				rolledBack = true;
			},
			getAlarm: storage.getAlarm.bind(storage),
			setAlarm: storage.setAlarm.bind(storage),
			deleteAlarm: storage.deleteAlarm.bind(storage),
		};
		try {
			const result = await closure(transaction);
			if (rolledBack) restore();
			return result;
		} catch (error) {
			restore();
			throw error;
		}
	}
	async getAlarm(): Promise<number | null> {
		return this.alarm;
	}
	async setAlarm(scheduledTime: number | Date): Promise<void> {
		this.operations.push({ kind: 'alarm', keys: 0 });
		this.alarm = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
	}
	async deleteAlarm(): Promise<void> {
		this.alarm = null;
	}
	async sync(): Promise<void> {}
	get sql(): SqlStorage {
		return unsupported('sql');
	}
	get kv(): SyncKvStorage {
		return unsupported('kv');
	}
	transactionSync<T>(closure: () => T): T {
		return closure();
	}
	getCurrentBookmark(): Promise<string> {
		return unsupported('getCurrentBookmark');
	}
	getBookmarkForTime(): Promise<string> {
		return unsupported('getBookmarkForTime');
	}
	onNextSessionRestoreBookmark(): Promise<string> {
		return unsupported('onNextSessionRestoreBookmark');
	}
	snapshot(): Map<string, unknown> {
		return new Map([...this.data.keys()].sort().map(key => [key, cloned(this.entries.read(key))]));
	}
}

export function durableObjectState(name: string, storage: MemoryStorage): DurableObjectState {
	const id: DurableObjectId = {
		name,
		toString: () => name,
		equals: other => other.toString() === name,
	};
	return {
		id,
		storage,
		props: undefined,
		get exports(): Cloudflare.Exports {
			return unsupported('exports');
		},
		facets: {
			get: () => unsupported('facets'),
			abort: () => unsupported('facets'),
			delete: () => unsupported('facets'),
			clone: () => unsupported('facets'),
		},
		waitUntil: deferBackground,
		blockConcurrencyWhile: callback => callback(),
		acceptWebSocket: () => unsupported('acceptWebSocket'),
		getWebSockets: () => [],
		setWebSocketAutoResponse() {},
		getWebSocketAutoResponse: () => null,
		getWebSocketAutoResponseTimestamp: () => null,
		setHibernatableWebSocketEventTimeout() {},
		getHibernatableWebSocketEventTimeout: () => null,
		getTags: () => [],
		abort: reason => unsupported(`abort(${reason ?? ''})`),
	};
}
