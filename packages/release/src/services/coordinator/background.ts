import { Cause, Context, Effect, Exit, FiberSet, Layer } from 'effect';

export class Background extends Context.Service<Background, {
	readonly fork: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}>()('beepboopbot/release/Background') {
	static layer(waitUntil: (work: Promise<unknown>) => void): Layer.Layer<Background> {
		return Layer.effect(
			Background,
			Effect.gen(function*() {
				const fibers = yield* FiberSet.make<void, never>();
				yield* Effect.addFinalizer(() => FiberSet.awaitEmpty(fibers));
				return Background.of({
					fork: work =>
						FiberSet.run(fibers, work).pipe(
							Effect.flatMap(fiber =>
								Effect.sync(() =>
									waitUntil(
										new Promise((resolve, reject) =>
											fiber.addObserver(exit =>
												Exit.isSuccess(exit) ? resolve(undefined) : reject(Cause.squash(exit.cause))
											)
										),
									)
								)
							),
						),
				});
			}),
		);
	}
}
