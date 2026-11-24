import { expect, test } from 'bun:test';
import { MemoryStorage } from '@root/test/support/do-storage.ts';
import { Effect, Exit, Layer } from 'effect';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';

const now = 1_000_000;

async function planned<A>(stored: unknown, work: (planner: AlarmPlanner['Service']) => Effect.Effect<A, unknown>) {
	const memory = new MemoryStorage();
	if (stored !== undefined) await memory.put('reconcile-at', stored);
	const exit = await Effect.runPromiseExit(
		AlarmPlanner.use(work).pipe(
			Effect.provide(AlarmPlanner.layer.pipe(Layer.provideMerge(DurableStorage.layer(memory)))),
		),
	);
	return { exit, stored: memory.snapshot().get('reconcile-at'), alarm: memory.alarm };
}

test('a reconcile is due when none was ever planned or its time has come, and not when it was released, unreadable or later', async () => {
	const due = async (stored: unknown) => (await planned(stored, planner => planner.reconcileDue(now))).exit;
	expect(await due(undefined)).toEqual(Exit.succeed(true));
	expect(await due(now)).toEqual(Exit.succeed(true));
	expect(await due(now - 1)).toEqual(Exit.succeed(true));
	expect(await due(now + 1)).toEqual(Exit.succeed(false));
	expect(await due(null)).toEqual(Exit.succeed(false));
	expect(await due('soon')).toEqual(Exit.succeed(false));
});

test('holding a reconcile overrides any planned time, releasing it plans none, and a request only moves it earlier', async () => {
	expect((await planned(now - 5, planner => planner.holdReconcile(now + 60_000))).stored).toBe(now + 60_000);
	expect((await planned(now + 5, planner => planner.releaseReconcile)).stored).toBeNull();
	expect((await planned(now + 60_000, planner => planner.requestReconcile(now))).stored).toBe(now);
	expect((await planned(now, planner => planner.requestReconcile(now + 60_000))).stored).toBe(now);
	expect((await planned(null, planner => planner.requestReconcile(now))).stored).toBe(now);
});

test('a reconcile write for a batch carries the earlier of the planned and the requested time and leaves storage alone', async () => {
	expect(await planned(now + 60_000, planner => planner.reconcileWrite(now))).toEqual({
		exit: Exit.succeed({ key: 'reconcile-at', value: now }),
		stored: now + 60_000,
		alarm: null,
	});
	expect((await planned(now, planner => planner.reconcileWrite(now + 60_000))).exit).toEqual(
		Exit.succeed({ key: 'reconcile-at', value: now }),
	);
	expect((await planned('soon', planner => planner.reconcileWrite(now))).exit).toEqual(
		Exit.succeed({ key: 'reconcile-at', value: now }),
	);
});

test('the planner arms the alarm at the planned reconcile without any other source registered', async () => {
	const { alarm } = await planned(now + 5_000, planner => planner.reschedule);
	expect(alarm).toBe(now + 5_000);
});
