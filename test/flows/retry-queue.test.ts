import { expect, spyOn, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { Effect, Exit, Layer, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition, upstream } from '@/kernel/errors/domain-error.ts';
import { decodeSync, looseStruct } from '@/kernel/schema/structs.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { InboxEntry, Observation } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import {
	AuditTrail,
	InboxQueue,
	inboxPolicy,
	ObserveQueue,
	RetryQueue,
	TrackQueue,
	trackLater,
} from '@/release/services/coordinator/retry-queue.ts';

type Queues = InboxQueue | ObserveQueue | TrackQueue | AlarmPlanner;
type Audited = [string, string, string];

function run<A>(memory: MemoryStorage, audited: Audited[], work: Effect.Effect<A, DomainError, Queues>) {
	const audit = Layer.succeed(AuditTrail, {
		record: (action, target, failure) =>
			Effect.sync(() => {
				audited.push([action, target, failure]);
			}),
	});
	return Effect.runPromiseExit(work.pipe(Effect.provide(
		Layer.mergeAll(InboxQueue.layer, ObserveQueue.layer, TrackQueue.layer).pipe(
			Layer.provideMerge(AlarmPlanner.layer),
			Layer.provide(audit),
			Layer.provideMerge(DurableStorage.layer(memory)),
		),
	)));
}

function until<A>(
	queue: RetryQueue<A>,
	handle: (entry: A) => Effect.Effect<A | undefined, DomainError>,
	times: readonly number[],
): Effect.Effect<void, DomainError> {
	return Effect.forEach(times, now => queue.drain(now, handle), { discard: true });
}

const outage = upstream('github', 'GitHub unreachable');
const refusal = precondition('not ready');

function written(memory: MemoryStorage): string {
	return JSON.stringify([...memory.snapshot()]);
}
const queuedRun: Observation = { repositoryId: 1, runId: 7 };
const inboxEntry: InboxEntry = {
	delivery: 'd',
	repositoryId: 1,
	event: { kind: 'push', ref: 'main' },
	attempts: 0,
	due: 0,
};

test('the inbox retries an outage with doubling delays and dead-letters it after exactly eight attempts', async () => {
	const memory = new MemoryStorage();
	await memory.put('inbox:k', inboxEntry);
	const audited: Audited[] = [];
	const dues: number[] = [];
	const exit = await run(
		memory,
		audited,
		Effect.gen(function*() {
			const inbox = yield* InboxQueue;
			let now = 0;
			for (let attempt = 1; attempt <= 8; attempt++) {
				yield* inbox.drain(now, () => Effect.fail(outage));
				const stored = memory.snapshot().get('inbox:k');
				if (stored === undefined) break;
				const { due } = decodeSync(looseStruct({ due: Schema.Finite }), stored);
				dues.push(due - now);
				yield* inbox.drain(due - 1, () => Effect.die('ran before its due time'));
				now = due;
			}
		}),
	);
	expect(exit).toEqual(Exit.void);
	expect(dues).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_840_000]);
	expect(written(memory)).toBe(JSON.stringify([['inbox-dead:d', {
		...inboxEntry,
		attempts: 8,
		due: 7_620_000 + 60_000 * 2 ** 7,
		error: outage.message,
	}]]));
	expect(audited).toEqual([[
		'inbox.dead',
		`d: push after 8 attempts: ${outage.message}`,
		'inbox.audit-failed',
	]]);
});

test('the inbox dead-letters a failure that is not an outage at once and removes handled entries', async () => {
	const memory = new MemoryStorage();
	await memory.put({ 'inbox:d': inboxEntry, 'inbox:e': { ...inboxEntry, delivery: 'e' }, 'inbox:x': { broken: true } });
	const audited: Audited[] = [];
	const refused = precondition('suspended');
	const exit = await run(
		memory,
		audited,
		InboxQueue.use(inbox => inbox.drain(0, entry => entry.delivery === 'd' ? Effect.fail(refused) : Effect.undefined)),
	);
	expect(exit).toEqual(Exit.void);
	expect([...memory.snapshot().keys()]).toEqual(['inbox-dead:d']);
	expect(audited).toEqual([['inbox.dead', `d: push after 1 attempts: ${refused.message}`, 'inbox.audit-failed']]);
});

for (const [name, key, interval] of [['observe', 'observe', 60_000], ['track', 'track', 30_000]] as const) {
	test(`the ${name} queue retries every ${interval / 1000} seconds and drops a run after exactly ten failures`, async () => {
		const memory = new MemoryStorage();
		await memory.put(`${key}:7`, { repositoryId: 1, runId: 7 });
		const audited: Audited[] = [];
		const exit = await run(
			memory,
			audited,
			Effect.gen(function*() {
				const queue = name === 'observe' ? yield* ObserveQueue : yield* TrackQueue;
				yield* until(queue, () => Effect.fail(refusal), Array.from({ length: 9 }, (_, i) => i * interval));
				const kept = written(memory);
				yield* queue.drain(9 * interval - 1, () => Effect.die('ran before its due time'));
				yield* queue.drain(9 * interval, () => Effect.fail(refusal));
				return kept;
			}),
		);
		expect(exit).toEqual(Exit.succeed(JSON.stringify([[`${key}:7`, {
			repositoryId: 1,
			runId: 7,
			due: 9 * interval,
			attempts: 9,
			error: refusal.message,
		}]])));
		expect(memory.snapshot()).toEqual(
			new Map([[`${key}-dead:7`, {
				repositoryId: 1,
				runId: 7,
				due: 10 * interval,
				attempts: 10,
				error: refusal.message,
			}]]),
		);
		expect(audited).toEqual([[`${name}.dead`, `run 7 after 10 attempts: ${refusal.message}`, `${name}.audit-failed`]]);
	});
}

test('a run that is still going is tracked again thirty seconds later, and an unreadable entry is dropped', async () => {
	const memory = new MemoryStorage();
	const failed: Observation = { repositoryId: 1, runId: 7, due: 0, attempts: 3, error: 'earlier' };
	await memory.put({
		'track:7': failed,
		'track:8': { runId: 'eight' },
		'track:9': { repositoryId: 1, runId: 9, due: 5 },
	});
	const exit = await run(
		memory,
		[],
		TrackQueue.use(queue => queue.drain(1, event => Effect.succeed(trackLater(event, 1)))),
	);
	expect(exit).toEqual(Exit.void);
	expect(written(memory)).toBe(JSON.stringify([
		['track:7', { repositoryId: 1, runId: 7, due: 30_001 }],
		['track:9', { repositoryId: 1, runId: 9, due: 5 }],
	]));
});

const storageReset = new Error('storage reset');

function failOnce(memory: MemoryStorage, method: 'put' | 'delete'): void {
	spyOn(memory, method).mockImplementationOnce(async () => {
		throw storageReset;
	});
}

test('a handled entry whose acknowledgement fails stays queued without counting as a failed attempt', async () => {
	for (const [method, handled] of [['delete', undefined], ['put', trackLater(queuedRun, 0)]] as const) {
		const memory = new MemoryStorage();
		await memory.put('track:7', queuedRun);
		failOnce(memory, method);
		const audited: Audited[] = [];
		const exit = await run(memory, audited, TrackQueue.use(queue => queue.drain(0, () => Effect.succeed(handled))));
		expect(Exit.isFailure(exit)).toBe(true);
		expect([...memory.snapshot()]).toEqual([['track:7', queuedRun]]);
		expect(audited).toEqual([]);
	}
});

test('a failed retry write leaves the entry and its attempt count as they were', async () => {
	const memory = new MemoryStorage();
	await memory.put('inbox:d', inboxEntry);
	failOnce(memory, 'put');
	const audited: Audited[] = [];
	const exit = await run(memory, audited, InboxQueue.use(inbox => inbox.drain(0, () => Effect.fail(outage))));
	expect(Exit.isFailure(exit)).toBe(true);
	expect([...memory.snapshot()]).toEqual([['inbox:d', inboxEntry]]);
	expect(audited).toEqual([]);
});

test('a failed dead-letter write keeps the entry queued and unaudited', async () => {
	const memory = new MemoryStorage();
	await memory.put('inbox:d', inboxEntry);
	failOnce(memory, 'put');
	const audited: Audited[] = [];
	const exit = await run(memory, audited, InboxQueue.use(inbox => inbox.drain(0, () => Effect.fail(refusal))));
	expect(Exit.isFailure(exit)).toBe(true);
	expect([...memory.snapshot()]).toEqual([['inbox:d', inboxEntry]]);
	expect(audited).toEqual([]);
});

test('a failed terminal removal keeps the dead letter and leaves the entry queued', async () => {
	const memory = new MemoryStorage();
	await memory.put('inbox:d', inboxEntry);
	failOnce(memory, 'delete');
	const audited: Audited[] = [];
	const exit = await run(memory, audited, InboxQueue.use(inbox => inbox.drain(0, () => Effect.fail(refusal))));
	expect(Exit.isFailure(exit)).toBe(true);
	expect([...memory.snapshot().keys()]).toEqual(['inbox-dead:d', 'inbox:d']);
	expect(audited).toEqual([]);
});

test('a queue leaves the alarm planner when its scope closes', async () => {
	const memory = new MemoryStorage();
	await memory.put('inbox:d', { ...inboxEntry, due: 5_000 });
	const exit = await Effect.runPromiseExit(
		Effect.gen(function*() {
			const planner = yield* AlarmPlanner;
			const before = yield* planner.nextAlarm;
			yield* Effect.scoped(Effect.gen(function*() {
				yield* RetryQueue.make(inboxPolicy);
				expect(yield* planner.nextAlarm).toBe(5_000);
			}));
			return [before, yield* planner.nextAlarm];
		}).pipe(Effect.provide(
			Layer.mergeAll(AlarmPlanner.layer, Layer.succeed(AuditTrail, { record: () => Effect.void })).pipe(
				Layer.provideMerge(DurableStorage.layer(memory)),
			),
		)),
	);
	expect(exit).toEqual(Exit.succeed([undefined, undefined]));
});
