import { Effect } from 'effect';
import { attemptPromise, refuse, ToolFailure } from '@/tooling/runtime';

export function registry(url: string): Effect.Effect<Response, ToolFailure> {
	return attemptPromise(signal =>
		fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
	).pipe(
		Effect.filterOrElse(
			response => response.ok || response.status === 404,
			response => refuse(`Registry returned HTTP ${response.status}`),
		),
		Effect.mapError(failure => new ToolFailure({ message: `${url}: ${failure.message}`, cause: failure })),
	);
}
