import { Data, Effect } from 'effect';

export class ResponseReadError extends Data.TaggedError('ResponseReadError')<{ readonly cause: unknown }> {}
const readFailure = (cause: unknown) => new ResponseReadError({ cause });

export function responseText(response: Response): Effect.Effect<string, ResponseReadError> {
	return Effect.acquireUseRelease(
		Effect.try({ try: () => response.body?.getReader(), catch: readFailure }),
		reader => Effect.gen(function*() {
			if (!reader) return '';
			const decoder = new TextDecoder();
			let text = '';
			for (;;) {
				const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: readFailure });
				if (chunk.done) return text + decoder.decode();
				text += decoder.decode(chunk.value, { stream: true });
			}
		}),
		reader =>
			reader
				? Effect.promise(async () => {
					try {
						await reader.cancel().catch(() => undefined);
					} finally {
						reader.releaseLock();
					}
				})
				: Effect.void,
	);
}

export function responseJson(response: Response): Effect.Effect<unknown, ResponseReadError> {
	return responseText(response).pipe(
		Effect.flatMap(text => Effect.try({ try: (): unknown => JSON.parse(text), catch: readFailure })),
	);
}
