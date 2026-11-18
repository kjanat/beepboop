import { Context, Effect, Schedule } from 'effect';

export const ioConcurrency = 8;

export const TransientBackoff = Context.Reference<(delay: number) => Schedule.Schedule<unknown>>(
	'beepboop/runtime/TransientBackoff',
	{ defaultValue: () => delay => Schedule.exponential(delay) },
);

export function retryTransient<E>(options: {
	readonly attempts: number;
	readonly delay: number;
	readonly while: (error: E) => boolean;
}) {
	return <A, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.gen(function*() {
			const backoff = yield* TransientBackoff;
			return yield* effect.pipe(Effect.retry({
				schedule: backoff(options.delay),
				times: Math.max(0, options.attempts - 1),
				while: options.while,
			}));
		});
}
