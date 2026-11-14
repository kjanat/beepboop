import { Data, Effect } from 'effect';

export class ResponseReadError extends Data.TaggedError('ResponseReadError')<{ readonly cause: unknown }> {}
const readFailure = (cause: unknown) => new ResponseReadError({ cause });

type Body = Pick<Response, 'body'>;

function cancelBody(cancel: () => Promise<unknown>): Promise<void> {
	return new Promise(resolve => {
		const finish = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(finish, 1000);
		Promise.resolve().then(cancel).then(finish, finish);
	});
}

export function scopedResponse<E, R>(request: Effect.Effect<Response, E, R>) {
	return Effect.acquireRelease(
		request,
		response => {
			const body = response.body;
			return body ? Effect.promise(() => cancelBody(() => body.cancel())) : Effect.void;
		},
		{ interruptible: true },
	);
}

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
						await cancelBody(() => reader.cancel());
					} finally {
						reader.releaseLock();
					}
				})
				: Effect.void,
	);
}

export function responseText(
	response: Body,
	options: { readonly maxBytes?: number } = {},
): Effect.Effect<string, ResponseReadError> {
	return readBody(response, reader => Effect.gen(function*() {
		if (!reader) return '';
		const decoder = new TextDecoder();
		let text = '';
		let remaining = options.maxBytes ?? Infinity;
		for (;;) {
			if (remaining <= 0) return text + decoder.decode();
			const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: readFailure });
			if (chunk.done) return text + decoder.decode();
			const bytes = remaining < chunk.value.byteLength ? chunk.value.subarray(0, remaining) : chunk.value;
			remaining -= bytes.byteLength;
			text += decoder.decode(bytes, { stream: true });
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
