import { Data, Effect } from 'effect';

export class ResponseReadError extends Data.TaggedError('ResponseReadError')<{ readonly cause: unknown }> {}
const readFailure = (cause: unknown) => new ResponseReadError({ cause });

type Body = Pick<Response, 'body'>;

function readBody<A>(
	response: Body,
	read: (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => Effect.Effect<A, ResponseReadError>,
): Effect.Effect<A, ResponseReadError> {
	return Effect.acquireUseRelease(
		Effect.try({ try: () => response.body?.getReader(), catch: readFailure }),
		read,
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

export function responseText(response: Body): Effect.Effect<string, ResponseReadError> {
	return readBody(response, reader => Effect.gen(function*() {
		if (!reader) return '';
		const decoder = new TextDecoder();
		let text = '';
		for (;;) {
			const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: readFailure });
			if (chunk.done) return text + decoder.decode();
			text += decoder.decode(chunk.value, { stream: true });
		}
	}));
}

export function responseBytes(response: Body): Effect.Effect<Uint8Array<ArrayBuffer>, ResponseReadError> {
	return readBody(response, reader => Effect.gen(function*() {
		const chunks: Uint8Array[] = [];
		let size = 0;
		if (reader) {
			for (;;) {
				const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: readFailure });
				if (chunk.done) break;
				chunks.push(chunk.value);
				size += chunk.value.byteLength;
			}
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	}));
}

export function responseJson(response: Body): Effect.Effect<unknown, ResponseReadError> {
	return responseText(response).pipe(
		Effect.flatMap(text => Effect.try({ try: (): unknown => JSON.parse(text), catch: readFailure })),
	);
}
