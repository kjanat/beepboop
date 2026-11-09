import { Effect, Result } from 'effect';

export type Refusal<E> = (message: string) => E;

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function failWith<E>(refusal: Refusal<E>): (message: string) => Effect.Effect<never, E> {
	return message => Effect.fail(refusal(message));
}

export function rejectWith<E>(refusal: Refusal<E>): (message: string) => Result.Result<never, E> {
	return message => Result.fail(refusal(message));
}

export function attemptWith<E>(refusal: Refusal<E>): <A>(run: () => A) => Result.Result<A, E> {
	return run => Result.try({ try: run, catch: error => refusal(errorMessage(error)) });
}
