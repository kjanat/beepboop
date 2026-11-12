import { Cause, Effect } from 'effect';
import { decodeError } from '@/automation/store';
import type { DomainError } from '@/contract/errors';
import { recover } from '@/failure';

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
