import { Effect, Result, Schema } from 'effect';
import type { ApiError } from '@/kernel/errors/domain-error.ts';
import { apiError, DomainError, messageOf } from '@/kernel/errors/domain-error.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';

interface Classified {
	problem: ApiError;
	message: string;
}

const d1Failure = /^D1_ERROR\b/;
const rpcDomainError = Schema.TaggedStruct('DomainError', {
	problem: apiError,
	message: Schema.String,
});

export function classify(error: unknown, incident: string): Classified {
	if (error instanceof DomainError) return { problem: error.problem, message: error.message };
	if (error instanceof Error) {
		const decoded = safeDecode(rpcDomainError, error);
		if (decoded.success) return { problem: decoded.data.problem, message: decoded.data.message };
	}
	if (error instanceof Schema.SchemaError) {
		const problem: ApiError = { code: 'internal', incident };
		return { problem, message: messageOf(problem) };
	}
	if (error instanceof Error && d1Failure.test(error.message)) {
		const problem: ApiError = { code: 'upstream', service: 'd1', retryable: true };
		return { problem, message: messageOf(problem) };
	}
	if (error instanceof SyntaxError) {
		const message = 'Invalid JSON in request or configuration';
		return { problem: { code: 'invalid', issues: [{ path: [], message }] }, message };
	}
	const problem: ApiError = { code: 'internal', incident };
	return { problem, message: messageOf(problem) };
}

export function retryable(error: unknown): boolean {
	return classify(error, '').problem.code === 'upstream';
}

export function toDomainError(error: unknown): DomainError {
	if (error instanceof DomainError) return error;
	const { problem, message } = classify(error, crypto.randomUUID());
	const detail = error instanceof Schema.SchemaError
		? error.message
		: error instanceof Error
		? error.message
		: String(error);
	return new DomainError({ problem, message, detail, cause: error });
}

export function fromPromise<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, DomainError> {
	return Effect.tryPromise({ try: run, catch: toDomainError });
}

export function fromSync<A>(run: () => A): Effect.Effect<A, DomainError> {
	return Effect.suspend(() => Result.match(Result.try(run), {
		onSuccess: Effect.succeed,
		onFailure: error =>
			error instanceof DomainError || error instanceof Schema.SchemaError || error instanceof SyntaxError
				? Effect.fail(toDomainError(error))
				: Effect.die(error),
	}));
}

export function fromJson(source: string): Effect.Effect<unknown, DomainError> {
	return fromSync((): unknown => JSON.parse(source));
}

export function recover<B, E, R2>(handler: (error: DomainError) => Effect.Effect<B, E, R2>) {
	return <A, R>(effect: Effect.Effect<A, DomainError, R>): Effect.Effect<A | B, E, R | R2> =>
		effect.pipe(Effect.catch(handler));
}
