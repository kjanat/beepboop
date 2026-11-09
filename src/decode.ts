import { Effect } from 'effect';
import type { z } from 'zod';

export function decodeWith<S extends z.ZodType, E>(
	schema: S,
	value: unknown,
	reject: (error: z.ZodError) => E,
): Effect.Effect<z.output<S>, E> {
	const parsed = schema.safeParse(value);
	return parsed.success ? Effect.succeed(parsed.data) : Effect.fail(reject(parsed.error));
}

export function parseWith<E>(
	attempt: <A>(run: () => A) => Effect.Effect<A, E>,
): <S extends z.ZodType>(schema: S, value: unknown) => Effect.Effect<z.output<S>, E> {
	return (schema, value) => attempt(() => schema.parse(value));
}
