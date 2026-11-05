import { deserialize, serialize } from 'bun:jsc';
import { durableObjectState, MemoryStorage } from '@root/test/support/do-storage.ts';

export interface RpcCall {
	object: string;
	method: string;
	at: number;
}

function cloned(value: unknown): ReturnType<typeof deserialize> {
	return value === undefined ? undefined : deserialize(serialize(value));
}

function stub(name: string, target: object, calls: RpcCall[]): ReturnType<typeof deserialize> {
	return new Proxy(Object.create(null), {
		get(_, property) {
			if (typeof property !== 'string' || property === 'then') return undefined;
			if (property === 'name') return name;
			return async (...args: unknown[]) => {
				calls.push({ object: name, method: property, at: Date.now() });
				const method: unknown = Reflect.get(target, property);
				if (typeof method !== 'function') throw new TypeError(`RPC method ${property} does not exist`);
				return cloned(await Reflect.apply(method, target, cloned(args)));
			};
		},
	});
}

export interface Instance<T> {
	name: string;
	object: T;
	storage: MemoryStorage;
}

export class FakeNamespace<T extends Rpc.DurableObjectBranded> {
	readonly instances = new Map<string, Instance<T>>();
	readonly calls: RpcCall[] = [];
	constructor(
		readonly className: string,
		private readonly create: (state: DurableObjectState) => T,
	) {}
	instance(name: string): Instance<T> {
		const existing = this.instances.get(name);
		if (existing) return existing;
		const storage = new MemoryStorage();
		const created = { name, object: this.create(durableObjectState(name, storage)), storage };
		this.instances.set(name, created);
		return created;
	}
	getByName(name: string): DurableObjectStub<T> {
		return stub(`${this.className}:${name}`, this.instance(name).object, this.calls);
	}
	idFromName(name: string): DurableObjectId {
		return { name, toString: () => name, equals: other => other.toString() === name };
	}
	idFromString(id: string): DurableObjectId {
		return this.idFromName(id);
	}
	newUniqueId(): DurableObjectId {
		return this.idFromName(crypto.randomUUID());
	}
	get(id: DurableObjectId): DurableObjectStub<T> {
		return this.getByName(id.toString());
	}
	jurisdiction(): FakeNamespace<T> {
		return this;
	}
}
