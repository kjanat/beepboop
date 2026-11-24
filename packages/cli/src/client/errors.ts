import { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { failure, signIn } from '@/cli/render/output';
import type { ApiFailure, Unreachable } from '@/contract/client';
import { failureOf } from '@/contract/client';
import type { ErrorCode } from '@/kernel/errors/domain-error.ts';

const codes = {
	unauthenticated: 'SESSION_REVOKED',
	forbidden: 'FORBIDDEN',
	'not-found': 'NOT_FOUND',
	'method-not-allowed': 'UNSUPPORTED',
	invalid: 'INVALID_REQUEST',
	conflict: 'CONFLICT',
	precondition: 'PRECONDITION',
	upstream: 'UPSTREAM_UNAVAILABLE',
	internal: 'SERVER_ERROR',
} as const satisfies Record<ErrorCode, string>;

let warned = false;
export function warnOutage(response: Response): void {
	const notice = response.headers.get('beepboop-github-status');
	if (!notice || warned) return;
	warned = true;
	process.stderr.write(`warning: ${notice}\n`);
}
export function localFailure(error: unknown): CLIError {
	return failure(error instanceof Error ? error.message : String(error), 'LOCAL_IO');
}
export function local<A>(run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, CLIError> {
	return Effect.tryPromise({
		try: run,
		catch: localFailure,
	});
}
export function refusal(error: ApiFailure): CLIError {
	return error.status === 401
		? failure('Session revoked', 'SESSION_REVOKED', signIn)
		: new CLIError(error.message, {
			code: error.problem ? codes[error.problem.code] : `HTTP_${error.status}`,
			details: { status: error.status, ...(error.problem ? { problem: error.problem } : {}) },
		});
}
export function unreachable(error: Unreachable): Effect.Effect<never, CLIError> {
	return Effect.fail(failure(error.message, 'UNREACHABLE'));
}
export function reached<A>(effect: Effect.Effect<A, Unreachable>): Effect.Effect<A, CLIError> {
	return Effect.catch(effect, unreachable);
}
export function rejected(response: Response): Effect.Effect<never, CLIError> {
	return failureOf(response).pipe(
		Effect.flatMap(problem => Effect.fail(refusal(problem))),
	);
}
