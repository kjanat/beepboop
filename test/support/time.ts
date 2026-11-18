import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';

const settle = Effect.promise(() => new Promise<void>(resolve => setImmediate(resolve)));

export function virtualTime<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	return Effect.runPromise(
		Effect.gen(function*() {
			const fiber = yield* Effect.forkChild(effect);
			for (let steps = 0; steps < 2_000 && !fiber.pollUnsafe(); steps++) {
				yield* settle;
				yield* TestClock.adjust('50 millis');
			}
			if (!fiber.pollUnsafe()) return yield* Effect.die(new Error('Work did not finish within 100 virtual seconds'));
			return yield* Fiber.join(fiber);
		}).pipe(Effect.provide(TestClock.layer())),
	);
}
