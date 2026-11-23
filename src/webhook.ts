import { Effect } from 'effect';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

const MAX_BODY = 1_048_576;
export function readBody(request: Request): Effect.Effect<Uint8Array, DomainError> {
	return Effect.acquireUseRelease(
		Effect.sync(() => request.body?.getReader()),
		reader => Effect.gen(function*() {
			if (!reader) return yield* precondition('Missing body');
			const chunks: Uint8Array[] = [];
			let size = 0;
			for (;;) {
				const chunk = yield* fromPromise(() => reader.read());
				if (chunk.done) break;
				size += chunk.value.byteLength;
				if (size > MAX_BODY) {
					yield* fromPromise(() => reader.cancel());
					return yield* precondition('Body too large');
				}
				chunks.push(chunk.value);
			}
			const result = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				result.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return result;
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
