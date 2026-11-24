import { expect, test } from 'bun:test';
import { Deferred, Effect, ManagedRuntime } from 'effect';
import { Background } from '@/release/services/coordinator/background.ts';

function settled(work: Promise<unknown>): Promise<string> {
	return Promise.race([work.then(() => 'settled'), Bun.sleep(20).then(() => 'pending')]);
}

test('background work runs after its caller returns, hands its completion to waitUntil, and holds disposal until it ends', async () => {
	const handed: Promise<unknown>[] = [];
	const runtime = ManagedRuntime.make(Background.layer(work => handed.push(work)));
	const release = Deferred.makeUnsafe<void>();
	const order: string[] = [];
	await runtime.runPromise(Effect.gen(function*() {
		yield* (yield* Background).fork(Effect.gen(function*() {
			order.push('started');
			yield* Deferred.await(release);
			order.push('finished');
		}));
		order.push('returned');
	}));
	expect(order).toEqual(['started', 'returned']);
	expect(handed).toHaveLength(1);
	const [handedWork] = handed;
	if (!handedWork) throw new Error('No work handed to waitUntil');
	expect(await settled(handedWork)).toBe('pending');
	const disposed = runtime.dispose();
	expect(await settled(disposed)).toBe('pending');
	Effect.runSync(Deferred.succeed(release, undefined));
	await disposed;
	expect(await settled(handedWork)).toBe('settled');
	expect(order).toEqual(['started', 'returned', 'finished']);
});

test('background work that dies, or arrives after disposal, rejects the promise handed to waitUntil', async () => {
	const outcomes: Promise<string>[] = [];
	const runtime = ManagedRuntime.make(Background.layer(work => {
		outcomes.push(work.then(() => 'resolved', (error: unknown) => `rejected: ${String(error)}`));
	}));
	const background = await runtime.runPromise(Background.use(Effect.succeed));
	await runtime.runPromise(background.fork(Effect.die(new Error('tag service exploded'))));
	await runtime.dispose();
	let ran = false;
	await Effect.runPromise(background.fork(Effect.sync(() => {
		ran = true;
	})));
	expect(await Promise.all(outcomes)).toEqual([
		'rejected: Error: tag service exploded',
		'rejected: Error: All fibers interrupted without error',
	]);
	expect(ran).toBe(false);
});
