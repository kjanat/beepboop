import { Effect, Logger, References } from 'effect';
import { decodeError } from '@/automation/store';
import type { DomainError } from '@/contract/errors';
import { recover } from '@/failure';

const jsonLog = Logger.make(({ message, fiber }) => {
	const [event] = Array.isArray(message) ? message : [message];
	console.error(JSON.stringify({ event, ...fiber.getRef(References.CurrentLogAnnotations) }));
});

export function logFailure(
	event: string,
	error: DomainError,
	fields: Record<string, unknown> = {},
): Effect.Effect<void> {
	return Effect.logError(event).pipe(
		Effect.annotateLogs({ ...fields, error: decodeError(error) }),
		Effect.provideService(Logger.CurrentLoggers, new Set([jsonLog])),
	);
}

export function logRecovered(event: string, fields: Record<string, unknown> = {}) {
	return recover(error => logFailure(event, error, fields));
}
