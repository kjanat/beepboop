import { expect, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Projection } from '@/persistence/d1/projection';
import { Journal, ProjectionSink } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import type { CoordinatorServices } from '@/release/services/coordinator/layer.ts';
import { coordinatorLayer } from '@/release/services/coordinator/layer.ts';
import { AuditTrail } from '@/release/services/coordinator/retry-queue.ts';

function run<A, E>(memory: MemoryStorage, projected: Projection[], work: Effect.Effect<A, E, CoordinatorServices>) {
	const sink = Layer.succeed(ProjectionSink, {
		apply: rows =>
			Effect.sync(() => {
				projected.push(...rows);
			}),
	});
	const audit = Layer.succeed(AuditTrail, { record: () => Effect.void });
	const revisions = Layer.succeed(RepositoryRevisions, {
		get: () => Effect.undefined,
		inventoryAt: () => Effect.die('Unexpected snapshot'),
	});
	return Effect.runPromiseExit(
		work.pipe(Effect.provide(coordinatorLayer(memory).pipe(Layer.provide(Layer.mergeAll(sink, audit, revisions))))),
	);
}

test('the coordinator lock runs one piece of work at a time', async () => {
	const order: string[] = [];
	const exit = await run(
		new MemoryStorage(),
		[],
		Effect.gen(function*() {
			const lock = yield* CoordinatorLock;
			const release = yield* Deferred.make<void>();
			const step = (name: string, wait: Effect.Effect<void>) =>
				lock.serialized(Effect.gen(function*() {
					order.push(`${name} starts`);
					yield* wait;
					order.push(`${name} ends`);
				}));
			const first = yield* Effect.forkChild(step('first', Deferred.await(release)));
			yield* Effect.yieldNow;
			const second = yield* Effect.forkChild(step('second', Effect.void));
			yield* Effect.yieldNow;
			order.push('released');
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(first);
			yield* Fiber.join(second);
		}),
	);
	expect(exit).toEqual(Exit.void);
	expect(order).toEqual(['first starts', 'released', 'first ends', 'second starts', 'second ends']);
});

test('the coordinator lock projects the journal and arms the next alarm after work fails', async () => {
	const memory = new MemoryStorage();
	const projected: Projection[] = [];
	const failure = precondition('work failed');
	const exit = await run(
		memory,
		projected,
		Effect.gen(function*() {
			const lock = yield* CoordinatorLock;
			const failed = yield* Effect.exit(lock.serialized(Effect.gen(function*() {
				yield* (yield* Journal).commit([{ entity: 'release', id: 'r', repositoryId: 1, value: { id: 'r' } }]);
				yield* (yield* DurableStorage).write(Keys.reconcileAt, 42_000);
				return yield* failure;
			})));
			return { failed, after: yield* lock.serialized(Effect.succeed('next')) };
		}),
	);
	expect(exit).toEqual(Exit.succeed({ failed: Exit.fail(failure), after: 'next' }));
	expect(projected.map(row => [row.entity, row.id, row.revision])).toEqual([['release', 'r', 1]]);
	expect([...memory.snapshot().keys()]).toEqual(['journal:seq', 'reconcile-at', 'release:r']);
	expect(memory.alarm).toBe(42_000);
});
