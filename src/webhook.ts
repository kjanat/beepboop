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
