import { expect, test } from 'bun:test';
import { verifySignature } from '#webhook';

const body = new TextEncoder().encode('{"action":"published"}');
async function sign(bytes: Uint8Array, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(bytes)));
	return `sha256=${[...digest].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
test('raw-body HMAC rejects forgery, body mutation, and missing signature', async () => {
	const signature = await sign(body, 'secret');
	expect(await verifySignature(body, signature, 'secret')).toBe(true);
	expect(await verifySignature(body, signature, 'other')).toBe(false);
	expect(
		await verifySignature(
			new TextEncoder().encode('{ "action": "published" }'),
			signature,
			'secret',
		),
	).toBe(false);
	expect(await verifySignature(body, null, 'secret')).toBe(false);
});
