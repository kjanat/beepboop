import { expect, spyOn, test } from 'bun:test';
import { bearer, field, text } from '@root/test/support/http.ts';
import type { World } from '@root/test/support/world.ts';
import { adminSubject, eachWorld, origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { CborValue } from '@/cli/fido2/cbor';
import { encode } from '@/cli/fido2/cbor';
import { SessionStore } from '@/persistence/d1/sessions';

let world: World;
eachWorld(created => {
	world = created;
});

async function registration(challenge: string) {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
	const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const cose = await Effect.runPromise(Effect.fromResult(encode(new Map<number, CborValue>([
		[1, 2],
		[3, -7],
		[-1, 1],
		[-2, publicKey.slice(1, 33)],
		[-3, publicKey.slice(33)],
	]))));
	const credentialId = crypto.getRandomValues(new Uint8Array(32));
	const rpIdHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new URL(origin).hostname)),
	);
	const authData = new Uint8Array([
		...rpIdHash,
		0x45,
		0,
		0,
		0,
		0,
		...new Uint8Array(16),
		0,
		credentialId.length,
		...credentialId,
		...cose,
	]);
	const attestation = await Effect.runPromise(Effect.fromResult(encode(new Map<string, CborValue>([
		['fmt', 'none'],
		['attStmt', new Map()],
		['authData', authData],
	]))));
	const id = Buffer.from(credentialId).toString('base64url');
	return {
		id,
		rawId: id,
		type: 'public-key',
		clientExtensionResults: {},
		response: {
			clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin })).toString('base64url'),
			attestationObject: Buffer.from(attestation).toString('base64url'),
		},
	};
}

test('two initial enrollment challenges can commit only one first key', async () => {
	const api = bearer(world, await world.cliSession());
	const first = await api('/api/authenticators/options', { register: true });
	const second = await api('/api/authenticators/options', { register: true });
	expect(first.status).toBe(200);
	expect(second.status).toBe(200);
	const firstKey = await registration(text(field(first.body, 'options'), 'challenge'));
	const secondKey = await registration(text(field(second.body, 'options'), 'challenge'));
	for (const [options, response, expected] of [[first, firstKey, 200], [second, secondKey, 422]] as const) {
		const verified = await api('/api/authenticators/verify', { id: text(options.body, 'id'), response });
		expect(verified.status).toBe(expected);
	}
	expect(world.db.execute('SELECT id FROM authenticators WHERE subject=?', [adminSubject]).rows)
		.toEqual([{ id: firstKey.id }]);
});

test('enrollment racing the credential read retains the guarded initial mode', async () => {
	const api = bearer(world, await world.cliSession());
	const execute = world.db.execute.bind(world.db);
	let injected = false;
	spyOn(world.db, 'execute').mockImplementation((query, values) => {
		const result = execute(query, values);
		if (!injected && query === 'SELECT document FROM authenticators WHERE subject=?') {
			injected = true;
			execute('INSERT INTO authenticators(id,subject,document) VALUES(?,?,?)', [
				'a2V5',
				adminSubject,
				JSON.stringify({ id: 'a2V5', publicKey: 'AQID', counter: 0 }),
			]);
		}
		return result;
	});
	const options = await api('/api/authenticators/options', { register: true });
	expect(injected).toBe(true);
	expect(options.status).toBe(200);
	const response = await registration(text(field(options.body, 'options'), 'challenge'));
	expect((await api('/api/authenticators/verify', { id: text(options.body, 'id'), response })).status).toBe(422);
	expect(execute('SELECT id FROM authenticators WHERE subject=?', [adminSubject]).rows).toEqual([{ id: 'a2V5' }]);
});

test('additional enrollment requires fresh proof and consumes it only once', async () => {
	const api = bearer(world, await world.cliSession());
	const initial = await api('/api/authenticators/options', { register: true });
	const initialKey = await registration(text(field(initial.body, 'options'), 'challenge'));
	expect(
		(await api('/api/authenticators/verify', {
			id: text(initial.body, 'id'),
			response: initialKey,
		})).status,
	).toBe(200);
	expect((await api('/api/authenticators/options', { register: true })).status).toBe(403);
	await world.elevate();
	const additional = await api('/api/authenticators/options', { register: true, proof: 'proof' });
	expect(additional.status).toBe(200);
	expect((await api('/api/authenticators/options', { register: true, proof: 'proof' })).status).toBe(403);
	const additionalKey = await registration(text(field(additional.body, 'options'), 'challenge'));
	expect(
		(await api('/api/authenticators/verify', {
			id: text(additional.body, 'id'),
			response: additionalKey,
		})).status,
	).toBe(200);
	expect(
		world.db.execute('SELECT id FROM authenticators WHERE subject=? ORDER BY id', [adminSubject]).rows.map(row =>
			row.id
		),
	)
		.toEqual([initialKey.id, additionalKey.id].sort());
});

test('overlapping additional enrollment requests redeem the same proof only once', async () => {
	const api = bearer(world, await world.cliSession());
	const initial = await api('/api/authenticators/options', { register: true });
	const initialKey = await registration(text(field(initial.body, 'options'), 'challenge'));
	expect((await api('/api/authenticators/verify', { id: text(initial.body, 'id'), response: initialKey })).status).toBe(
		200,
	);
	await world.elevate();
	const first = api('/api/authenticators/options', { register: true, proof: 'proof' });
	const second = api('/api/authenticators/options', { register: true, proof: 'proof' });
	const replies = await Promise.all([first, second]);
	expect(replies.map(reply => reply.status).sort()).toEqual([200, 403]);
	expect(world.db.execute('SELECT id FROM authenticators WHERE subject=?', [adminSubject]).rows)
		.toEqual([{ id: initialKey.id }]);
});

test('legacy enrollment challenges expire instead of inferring an authorized mode', async () => {
	const api = bearer(world, await world.cliSession());
	await world.run(new SessionStore(world.db).open('security-challenge', 'legacy', {
		subject: adminSubject,
		register: true,
		first: false,
		challenge: 'old',
	}, 120_000));
	expect((await api('/api/authenticators/verify', { id: 'legacy', response: {} })).status).toBe(403);
	expect(world.db.execute('SELECT id FROM authenticators', []).rows).toHaveLength(0);
});
