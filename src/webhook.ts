import { Effect } from 'effect';
import { type DomainError, precondition } from '@/contract/errors';
import { fromPromise } from '@/failure';

const MAX_BODY = 1_048_576;
export function readBody(request: Request): Effect.Effect<Uint8Array, DomainError> {
	const reader = request.body?.getReader();
	if (!reader) return Effect.fail(precondition('Missing body'));
	return Effect.gen(function*() {
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
	}).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock())));
}
export function verifySignature(
	body: Uint8Array,
	signature: string | null,
	secret: string,
): Effect.Effect<boolean, DomainError> {
	if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return Effect.succeed(false);
	const bytes = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		bytes[i] = Number.parseInt(signature.slice(7 + 2 * i, 9 + 2 * i), 16);
	}
	return fromPromise(() =>
		crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
			'verify',
		])
	).pipe(Effect.flatMap(key => fromPromise(() => crypto.subtle.verify('HMAC', key, bytes, new Uint8Array(body)))));
}
