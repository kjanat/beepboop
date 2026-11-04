import { Cause, Effect, Exit, Option } from 'effect';
import { type Failure, toDomainError } from '@/effect/errors';

export async function run<A>(program: Effect.Effect<A, Failure>): Promise<A> {
	const exit = await Effect.runPromiseExit(program);
	if (Exit.isSuccess(exit)) return exit.value;
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isSome(failure)) throw toDomainError(failure.value);
	throw Cause.squash(exit.cause);
}
