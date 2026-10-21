import { type Configuration, integer, record, text } from '@/model.ts';

const MAX_BODY = 1_048_576;
export async function readBody(request: Request): Promise<Uint8Array> {
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Missing body');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > MAX_BODY) {
				await reader.cancel();
				throw new Error('Body too large');
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
export async function verifySignature(
	body: Uint8Array,
	signature: string | null,
	secret: string,
): Promise<boolean> {
	if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
	const bytes = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		bytes[i] = Number.parseInt(signature.slice(7 + 2 * i, 9 + 2 * i), 16);
	}
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	return crypto.subtle.verify('HMAC', key, bytes, new Uint8Array(body));
}
/** A webhook only wakes the reconciler. No payload field can select workflow, ref, or URL. */
export function acceptsEvent(
	event: string | null,
	value: unknown,
	configuration: Configuration,
): boolean {
	if (event !== 'release' && event !== 'workflow_run') return false;
	const data = record(value);
	const repository = record(data.repository);
	if (integer(record(repository.owner).id) !== configuration.ownerId) return false;
	const id = integer(repository.id);
	const name = text(repository.full_name);
	const known = configuration.routes.some((route) =>
		[route.source, route.destination].some((repo) => repo.id === id && repo.name === name)
	);
	if (!known) return false;
	return event === 'release'
		? data.action === 'published' || data.action === 'edited' || data.action === 'deleted'
		: data.action === 'completed';
}
