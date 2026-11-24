import { expect, setSystemTime, spyOn, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { loggedErrors } from '@root/test/support/process.ts';
import { Effect, Exit, Layer, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { jsonLogging } from '@/kernel/logging/json-logging.ts';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Projection } from '@/persistence/d1/projection';
import { Journal, ProjectionSink } from '@/persistence/durable/journal.ts';
import type { Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace, Singleton } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { journalLayout } from '@/release/adapters/do/keys.ts';

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

test('durable storage lists a bounded page, reads raw values by key, removes many ids and arms the alarm', async () => {
	const memory = new MemoryStorage();
	await memory.put({ 'note:a': { text: 'a' }, 'note:b': { text: 7 }, 'note:c': { text: 'c' } });

	const read = await run(
		memory,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const page = yield* storage.entries(notes, 2);
			const values = yield* storage.values(['note:b', 'note:z']);
			yield* storage.removeAll(notes, ['a', 'b']);
			const before = yield* storage.alarm;
			yield* storage.setAlarm(42);
			return { page: page.map(entry => [entry.id, entry.kind]), values, before, after: yield* storage.alarm };
		}),
	);
	expect(read).toEqual(Exit.succeed({
		page: [['a', 'readable'], ['b', 'unreadable']],
		values: new Map([['note:b', { text: 7 }]]),
		before: null,
		after: 42,
	}));
	expect(memory.snapshot()).toEqual(new Map([['note:c', { text: 'c' }]]));
});

test('durable storage writes every batch of a transaction or none of them', async () => {
	const memory = new MemoryStorage();
	const write = (batches: Write[][]) => run(memory, DurableStorage.use(storage => storage.transaction(batches)));

	expect(await write([[Keyspace.write(notes, 'a', { text: 'a' })], [Singleton.write(cursor, 1)]])).toEqual(Exit.void);
	expect(memory.snapshot()).toEqual(new Map<string, unknown>([['cursor', 1], ['note:a', { text: 'a' }]]));

	const refused = await write([[Keyspace.write(notes, 'b', { text: 'b' })], [{ key: 'bad', value: undefined }]]);
	expect(Exit.isFailure(refused)).toBe(true);
	expect(memory.snapshot()).toEqual(new Map<string, unknown>([['cursor', 1], ['note:a', { text: 'a' }]]));
});

function journal(memory: MemoryStorage, apply: (rows: readonly Projection[]) => Effect.Effect<void, DomainError>) {
	return <A, E>(work: Effect.Effect<A, E, Journal>) =>
		Effect.runPromiseExit(work.pipe(
			Effect.provide(
				Journal.layer(journalLayout).pipe(
					Layer.provide(Layer.succeed(ProjectionSink, { apply })),
					Layer.provide(DurableStorage.layer(memory)),
					Layer.merge(jsonLogging),
				),
			),
		));
}

test('a journal commit numbers revisions after the stored sequence and spans one transaction past one put', async () => {
	const memory = new MemoryStorage();
	await memory.put('journal:seq', 5);
	const transaction = spyOn(memory, 'transaction');
	const entries = Array.from({ length: 70 }, (_, index) => ({
		entity: 'release' as const,
		id: `r${index}`,
		repositoryId: 1,
		value: { index },
	}));
	const [first, ...rest] = entries;
	if (!first) throw new Error('No entries');

	expect(await journal(memory, () => Effect.void)(Journal.use(service => service.commit([first, ...rest]))))
		.toEqual(Exit.void);
	expect(transaction).toHaveBeenCalledTimes(1);
	const stored = memory.snapshot();
	expect(stored.get('journal:seq')).toBe(75);
	expect(stored.get('release:r69')).toEqual({ index: 69 });
	expect(stored.get('outbox:0000000000000075')).toEqual({
		entity: 'release',
		id: 'r69',
		repositoryId: 1,
		revision: 75,
	});
	expect([...stored.keys()].filter(key => key.startsWith('outbox:'))).toHaveLength(70);
});

test('a journal keeps its outbox due ten seconds after a failed projection and drains it on the next', async () => {
	setSystemTime(new Date(1_000_000));
	try {
		const memory = new MemoryStorage();
		const projected: [string, number][] = [];
		let failing = true;
		const run = journal(memory, rows =>
			failing
				? Effect.fail(precondition('projection down'))
				: Effect.sync(() => {
					projected.push(...rows.map((row): [string, number] => [row.id, row.revision]));
				}));
		const cycle = Effect.gen(function*() {
			const service = yield* Journal;
			const before = yield* service.due(1_000_000);
			yield* service.project;
			return { before, after: yield* service.due(1_000_000) };
		});

		const logged = loggedErrors();
		const cycles = await run(Effect.gen(function*() {
			const service = yield* Journal;
			yield* service.commit([{ entity: 'release', id: 'a', repositoryId: 1, value: { a: 1 } }]);
			yield* service.commit([{ entity: 'release', id: 'a', repositoryId: 1, value: { a: 2 } }]);
			const failed = yield* cycle;
			failing = false;
			const drained = yield* cycle;
			yield* service.commit([{ entity: 'release', id: 'b', repositoryId: 1, value: { b: 1 } }]);
			return [failed, drained, yield* service.due(1_000_000)];
		}));
		expect(cycles).toEqual(Exit.succeed([
			{ before: 1_000_000, after: 1_010_000 },
			{ before: 1_010_000, after: undefined },
			1_000_000,
		]));
		expect(logged.events()).toEqual([
			expect.objectContaining({ event: 'projection.failed', error: 'projection down' }),
		]);
		expect(projected).toEqual([['a', 2]]);
		expect([...memory.snapshot().keys()]).toEqual(['journal:seq', 'outbox:0000000000000003', 'release:a', 'release:b']);
	} finally {
		setSystemTime();
	}
});
