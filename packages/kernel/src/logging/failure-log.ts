import { Cause, Effect } from 'effect';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export function logFailure(
	event: string,
	error: DomainError,
	fields: Record<string, unknown> = {},
): Effect.Effect<void> {
	return Effect.logError(event, Cause.fail(error)).pipe(
		Effect.annotateLogs({ ...fields, error: decodeError(error) }),
	);
}

export function logRecovered(event: string, fields: Record<string, unknown> = {}) {
	return recover(error => logFailure(event, error, fields));
}
