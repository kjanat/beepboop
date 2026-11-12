import { Effect, Schedule } from 'effect';

export const ioConcurrency = 8;

export function retryTransient<E>(options: {
	readonly attempts: number;
	readonly delay: number;
	readonly while: (error: E) => boolean;
}) {
	return <A, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect.pipe(Effect.retry({
		schedule: Schedule.exponential(options.delay),
		times: Math.max(0, options.attempts - 1),
		while: options.while,
	}));
}
