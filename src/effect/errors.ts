import { Data, Effect } from 'effect';
import { type ApiError, DomainError, messageOf, type services } from '@/contract/errors';
import { classify } from '@/failure';

export type UpstreamService = (typeof services)[number];

export class Upstream extends Data.TaggedError('Upstream')<{
	readonly service: UpstreamService;
	readonly message: string;
}> {}

export class Refused extends Data.TaggedError('Refused')<{
	readonly problem: Exclude<ApiError, { code: 'upstream' }>;
	readonly message: string;
}> {}

export type Failure = Upstream | Refused;

export function problemOf(failure: Failure): ApiError {
	return failure._tag === 'Upstream'
		? { code: 'upstream', service: failure.service, retryable: true }
		: failure.problem;
}

export function toDomainError(failure: Failure): DomainError {
	return new DomainError(problemOf(failure), failure.message);
}

export function toFailure(error: unknown): Failure {
	if (error instanceof Upstream || error instanceof Refused) return error;
	const { problem, message } = classify(error, crypto.randomUUID());
	if (problem.code === 'upstream') return new Upstream({ service: problem.service, message });
	return new Refused({
		problem,
		message: error instanceof DomainError ? error.message : message || messageOf(problem),
	});
}

export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, Failure> {
	return Effect.tryPromise({ try: run, catch: toFailure });
}
