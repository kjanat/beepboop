import { Cause, Logger, References } from 'effect';

export const jsonLogging = Logger.layer([Logger.make(({ message, fiber, cause }) => {
	const [event, ...details] = Array.isArray(message) ? message : [message];
	console.error(JSON.stringify({
		event,
		...fiber.getRef(References.CurrentLogAnnotations),
		...(cause.reasons.length ? { cause: Cause.pretty(cause) } : {}),
		...(details.length ? { details } : {}),
	}));
})]);
