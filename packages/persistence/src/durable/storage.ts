import { Context, Effect, Layer } from 'effect';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import { decodeError, isDecodingFailure } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Singleton, Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';

export type Stored<A> =
	| { readonly kind: 'readable'; readonly value: A }
	| { readonly kind: 'unreadable'; readonly value: unknown; readonly error: string };
export type Entry<A> = Stored<A> & { readonly key: string; readonly id: string };

function stored<A>(decode: (value: unknown) => A, value: unknown): Stored<A> {
	try {
		return { kind: 'readable', value: decode(value) };
	} catch (error) {
		if (!isDecodingFailure(error)) throw error;
		return { kind: 'unreadable', value, error: decodeError(error) };
	}
}

function record(writes: readonly Write[]): Record<string, unknown> {
	return Object.fromEntries(writes.map(write => [write.key, write.value]));
}

export class DurableStorage extends Context.Service<DurableStorage, {
	readonly get: <A>(space: Keyspace<A>, id: string) => Effect.Effect<A | undefined, DomainError>;
	readonly find: <A>(space: Keyspace<A>, id: string) => Effect.Effect<Stored<A> | undefined, DomainError>;
	readonly has: <A>(space: Keyspace<A>, id: string) => Effect.Effect<boolean, DomainError>;
	readonly list: <A>(
		space: Keyspace<A>,
		limit?: number,
	) => Effect.Effect<{ readonly id: string; readonly value: A }[], DomainError>;
	readonly entries: <A>(space: Keyspace<A>, limit?: number) => Effect.Effect<Entry<A>[], DomainError>;
	readonly ids: <A>(space: Keyspace<A>) => Effect.Effect<string[], DomainError>;
	readonly values: (keys: readonly string[]) => Effect.Effect<Map<string, unknown>, DomainError>;
	readonly put: <A>(space: Keyspace<A>, id: string, value: A) => Effect.Effect<void, DomainError>;
	readonly remove: <A>(space: Keyspace<A>, id: string) => Effect.Effect<void, DomainError>;
	readonly removeAll: <A>(space: Keyspace<A>, ids: readonly string[]) => Effect.Effect<void, DomainError>;
	readonly read: <A>(singleton: Singleton<A>) => Effect.Effect<A | undefined, DomainError>;
	readonly peek: <A>(singleton: Singleton<A>) => Effect.Effect<Stored<A> | undefined, DomainError>;
	readonly write: <A>(singleton: Singleton<A>, value: A) => Effect.Effect<void, DomainError>;
	readonly clear: <A>(singleton: Singleton<A>) => Effect.Effect<void, DomainError>;
	readonly writeAll: (writes: readonly Write[]) => Effect.Effect<void, DomainError>;
	readonly transaction: (batches: readonly (readonly Write[])[]) => Effect.Effect<void, DomainError>;
	readonly alarm: Effect.Effect<number | null, DomainError>;
	readonly setAlarm: (at: number) => Effect.Effect<void, DomainError>;
	readonly dump: Effect.Effect<Write[], DomainError>;
}>()('beepboopbot/persistence/DurableStorage') {
	static layer(storage: DurableObjectStorage): Layer.Layer<DurableStorage> {
		const raw = (key: string) => fromPromise((): Promise<unknown> => storage.get(key));
		const listed = (prefix: string, limit?: number) =>
			fromPromise(() => storage.list(limit === undefined ? { prefix } : { prefix, limit }));
		const decoded = <A>(decode: (value: unknown) => A, key: string) =>
			raw(key).pipe(Effect.flatMap(value => value === undefined ? Effect.undefined : fromSync(() => decode(value))));
		const found = <A>(decode: (value: unknown) => A, key: string) =>
			raw(key).pipe(Effect.map(value => value === undefined ? undefined : stored(decode, value)));
		const remove = (key: string) => fromPromise(() => storage.delete(key)).pipe(Effect.asVoid);
		return Layer.succeed(DurableStorage, {
			get: (space, id) => decoded(space.decode, Keyspace.key(space, id)),
			find: (space, id) => found(space.decode, Keyspace.key(space, id)),
			has: (space, id) => raw(Keyspace.key(space, id)).pipe(Effect.map(value => value !== undefined)),
			list: (space, limit) =>
				listed(space.prefix, limit).pipe(
					Effect.flatMap(entries =>
						fromSync(() =>
							[...entries].map(([key, value]) => ({ id: Keyspace.id(space, key), value: space.decode(value) }))
						)
					),
				),
			entries: (space, limit) =>
				listed(space.prefix, limit).pipe(
					Effect.map(entries =>
						[...entries].map(([key, value]) => ({ ...stored(space.decode, value), key, id: Keyspace.id(space, key) }))
					),
				),
			ids: space =>
				listed(space.prefix).pipe(Effect.map(entries => [...entries.keys()].map(key => Keyspace.id(space, key)))),
			values: keys => fromPromise(() => storage.get<unknown>([...keys])),
			put: (space, id, value) => fromPromise(() => storage.put(Keyspace.key(space, id), value)),
			remove: (space, id) => remove(Keyspace.key(space, id)),
			removeAll: (space, ids) =>
				fromPromise(() => storage.delete(ids.map(id => Keyspace.key(space, id)))).pipe(Effect.asVoid),
			read: singleton => decoded(singleton.decode, singleton.key),
			peek: singleton => found(singleton.decode, singleton.key),
			write: (singleton, value) => fromPromise(() => storage.put(singleton.key, value)),
			clear: singleton => remove(singleton.key),
			writeAll: writes => fromPromise(() => storage.put(record(writes))),
			transaction: batches =>
				fromPromise(() =>
					storage.transaction(async transaction => {
						for (const writes of batches) await transaction.put(record(writes));
					})
				),
			alarm: fromPromise(() => storage.getAlarm()),
			setAlarm: at => fromPromise(() => storage.setAlarm(at)),
			dump: fromPromise(() => storage.list()).pipe(
				Effect.map(entries => [...entries].map(([key, value]) => ({ key, value }))),
			),
		});
	}
}
