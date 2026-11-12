import { Effect, Schema } from 'effect';
import type { Contract, Decoded } from '@/schema';

export function decodeWith<S extends Contract, E>(
	schema: S,
	value: unknown,
	reject: (error: Schema.SchemaError) => E,
): Effect.Effect<Decoded<S>, E> {
	return Schema.decodeUnknownEffect(schema, { errors: 'all' })(value).pipe(Effect.mapError(reject));
}

export function parseWith<E>(
	reject: (error: Schema.SchemaError) => E,
): <S extends Contract>(schema: S, value: unknown) => Effect.Effect<Decoded<S>, E> {
	return (schema, value) => decodeWith(schema, value, reject);
}
