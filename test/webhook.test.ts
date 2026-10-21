import { expect, test } from 'bun:test';
import { parseConfiguration } from '#config';
import { acceptsEvent, verifySignature } from '#webhook';
import { configuration } from './fixtures.ts';

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
test('signed events still need owner and immutable repository identity', () => {
	const payload = {
		action: 'published',
		repository: { id: 11, full_name: 'kjanat/source', owner: { id: 33 } },
	};
	expect(acceptsEvent('release', payload, configuration)).toBe(true);
	expect(
		acceptsEvent(
			'release',
			{ ...payload, repository: { ...payload.repository, id: 999 } },
			configuration,
		),
	).toBe(false);
	expect(
		acceptsEvent(
			'release',
			{ ...payload, repository: { ...payload.repository, owner: { id: 999 } } },
			configuration,
		),
	).toBe(false);
	expect(
		acceptsEvent(
			'release',
			{ ...payload, repository: { ...payload.repository, full_name: 'attacker/source' } },
			configuration,
		),
	).toBe(false);
	expect(acceptsEvent('push', payload, configuration)).toBe(false);
});
test('route config rejects cross-owner routing and missing evidence', () => {
	expect(parseConfiguration(configuration)).toEqual(configuration);
	const route = configuration.routes[0];
	if (!route) throw new Error('No route');
	expect(() =>
		parseConfiguration({
			...configuration,
			routes: [{ ...route, destination: { id: 22, name: 'attacker/target' } }],
		})
	).toThrow();
	expect(() => parseConfiguration({ ...configuration, routes: [{ ...route, readiness: [] }] })).toThrow();
});
