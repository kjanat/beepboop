import { Data, Effect } from 'effect';
import { parseWith } from '@/kernel/schema/decode.ts';

export class HostFailure
	extends Data.TaggedError('HostFailure')<{ readonly message: string; readonly cause?: unknown }>
{}

function message(cause: unknown): string {
	if (cause instanceof AggregateError) return [cause.message, ...cause.errors.map(message)].join('\n');
	return cause instanceof Error ? cause.message : String(cause);
}

function hostFailure(cause: unknown): HostFailure {
	return new HostFailure({ message: message(cause), cause });
}

export function attemptPromise<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, HostFailure> {
	return Effect.tryPromise({ try: run, catch: hostFailure });
}

export const parse = parseWith(hostFailure);

export function readJson(path: string): Effect.Effect<unknown, HostFailure> {
	return attemptPromise((): Promise<unknown> => Bun.file(path).json());
}
