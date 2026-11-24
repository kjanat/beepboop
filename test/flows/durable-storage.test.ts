import { expect, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { Effect, Exit, Schema } from 'effect';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import { Keyspace, Singleton } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';

const notes = Keyspace.make('note:', value => decodeSync(mutableStruct({ text: Schema.String }), value));
const cursor = Singleton.make('cursor', value => decodeSync(Schema.NullOr(Schema.Finite), value));
const invalid = 'Expected string\n  at ["text"]';

function run<A, E>(storage: MemoryStorage, work: Effect.Effect<A, E, DurableStorage>) {
	return Effect.runPromiseExit(work.pipe(Effect.provide(DurableStorage.layer(storage))));
}

test('durable storage reads undecodable entries as unreadable values and refuses them on strict reads', async () => {
	const memory = new MemoryStorage();
	await memory.put({ 'note:a': { text: 'kept' }, 'note:b': { text: 7 }, other: true });

	const read = await run(
		memory,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			return {
				entries: yield* storage.entries(notes),
				ids: yield* storage.ids(notes),
				found: yield* storage.find(notes, 'b'),
				missing: yield* storage.get(notes, 'z'),
				has: [yield* storage.has(notes, 'a'), yield* storage.has(notes, 'z')],
			};
		}),
	);
	expect(read).toEqual(Exit.succeed({
		entries: [
			{ kind: 'readable', key: 'note:a', id: 'a', value: { text: 'kept' } },
			{ kind: 'unreadable', key: 'note:b', id: 'b', value: { text: 7 }, error: invalid },
		],
		ids: ['a', 'b'],
		found: { kind: 'unreadable', value: { text: 7 }, error: invalid },
		missing: undefined,
		has: [true, false],
	}));
	expect(Exit.isFailure(await run(memory, DurableStorage.use(storage => storage.get(notes, 'b'))))).toBe(true);
	expect(Exit.isFailure(await run(memory, DurableStorage.use(storage => storage.list(notes))))).toBe(true);
});

test('durable storage writes keyspace and singleton keys under their exact names', async () => {
	const memory = new MemoryStorage();
	await run(
		memory,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			yield* storage.put(notes, 'a', { text: 'one' });
			yield* storage.write(cursor, null);
			yield* storage.writeAll([Keyspace.write(notes, 'b', { text: 'two' }), Singleton.write(cursor, 5)]);
			yield* storage.remove(notes, 'a');
		}),
	);
	expect(memory.snapshot()).toEqual(new Map<string, unknown>([['cursor', 5], ['note:b', { text: 'two' }]]));

	const read = await run(
		memory,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const before = { value: yield* storage.read(cursor), peeked: yield* storage.peek(cursor) };
			yield* storage.clear(cursor);
			return { ...before, cleared: yield* storage.peek(cursor), dump: yield* storage.dump };
		}),
	);
	expect(read).toEqual(Exit.succeed({
		value: 5,
		peeked: { kind: 'readable', value: 5 },
		cleared: undefined,
		dump: [{ key: 'note:b', value: { text: 'two' } }],
	}));
});
