import { beforeAll, expect, spyOn, test } from 'bun:test';
import { exportJWK, generateKeyPair } from 'jose';
import type { JwsKeyRequest } from 'micro509/jose';
import { remoteKeys } from '@/automation/jwks';
import type { Fetcher } from '@/automation/managers/registry';

const endpoint = new URL('https://issuer.example/.well-known/jwks');
let publicKey: JsonWebKey;
let rsaKey: JsonWebKey;
beforeAll(async () => {
	publicKey = await exportJWK((await generateKeyPair('ES256')).publicKey);
	rsaKey = await exportJWK((await generateKeyPair('RS256')).publicKey);
});
const document = (kid = 'current') => ({ keys: [{ ...publicKey, kid, alg: 'ES256', use: 'sig' }] });
const request = (kid = 'current', signal?: AbortSignal): JwsKeyRequest => ({
	algorithm: 'ES256',
	kid,
	header: { alg: 'ES256', kid, members: { alg: 'ES256', kid } },
	...(signal ? { signal } : {}),
});

test('unknown signing keys refresh after the successful-fetch cooldown', async () => {
	const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
	try {
		let calls = 0;
		const resolver = remoteKeys(endpoint, async () => Response.json(document(++calls === 1 ? 'current' : 'rotated')));
		expect((await resolver(request())).ok).toBe(true);
		expect(await resolver(request('rotated'))).toMatchObject({ ok: false, code: 'key_not_found' });
		expect(calls).toBe(1);
		clock.mockReturnValue(1_030_000);
		expect((await resolver(request('rotated'))).ok).toBe(true);
		expect(calls).toBe(2);
		expect(await resolver(request())).toMatchObject({ ok: false, code: 'key_not_found' });
		expect(calls).toBe(2);
	} finally {
		clock.mockRestore();
	}
});

test.each(['empty', 'expired'] as const)('overlapping refreshes cannot roll an %s cache backward', async state => {
	const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
	const delayed = Promise.withResolvers<Response>();
	const started = Promise.withResolvers<void>();
	let older: Promise<unknown> | undefined;
	try {
		let calls = 0;
		const transport: Fetcher = () => {
			calls++;
			if (state === 'expired' && calls === 1) return Promise.resolve(Response.json(document()));
			if (calls === (state === 'expired' ? 2 : 1)) {
				started.resolve();
				return delayed.promise;
			}
			return Promise.resolve(Response.json(document('rotated')));
		};
		const first = remoteKeys(endpoint, transport);
		const second = remoteKeys(endpoint, transport);
		if (state === 'expired') {
			expect((await first(request())).ok).toBe(true);
			clock.mockReturnValue(1_600_001);
		}
		older = Promise.resolve(first(request()));
		await started.promise;
		expect((await second(request('rotated'))).ok).toBe(true);
		delayed.resolve(Response.json(document()));
		expect(await older).toMatchObject({ ok: true });
		expect((await second(request('rotated'))).ok).toBe(true);
		expect(calls).toBe(state === 'expired' ? 3 : 2);
	} finally {
		delayed.resolve(Response.json(document()));
		await older;
		clock.mockRestore();
	}
});

test.each(
	[
		['with the same kid', 'current'],
		['without a kid', undefined],
	] as const,
)('algorithm rotation %s refreshes unsuitable keys only after cooldown', async (_name, kid) => {
	const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
	const select = (algorithm: 'RS256' | 'ES256'): JwsKeyRequest => ({
		algorithm,
		header: { alg: algorithm, members: { alg: algorithm, ...(kid ? { kid } : {}) }, ...(kid ? { kid } : {}) },
		...(kid ? { kid } : {}),
	});
	try {
		let calls = 0;
		let published = { keys: [{ ...rsaKey, alg: 'RS256', ...(kid ? { kid } : {}) }] };
		const resolver = remoteKeys(endpoint, async () => {
			calls++;
			return Response.json(published);
		});
		expect((await resolver(select('RS256'))).ok).toBe(true);
		expect(await resolver(select('ES256'))).toMatchObject({ ok: false, code: 'key_unsuitable' });
		expect(calls).toBe(1);
		clock.mockReturnValue(1_030_000);
		expect(await resolver(select('ES256'))).toMatchObject({ ok: false, code: 'key_unsuitable' });
		expect(calls).toBe(2);
		published = { keys: [{ ...publicKey, alg: 'ES256', ...(kid ? { kid } : {}) }] };
		expect(await resolver(select('ES256'))).toMatchObject({ ok: false, code: 'key_unsuitable' });
		expect(calls).toBe(2);
		clock.mockReturnValue(1_060_000);
		expect((await resolver(select('ES256'))).ok).toBe(true);
		expect(calls).toBe(3);
		expect((await resolver(select('ES256'))).ok).toBe(true);
		expect(calls).toBe(3);
	} finally {
		clock.mockRestore();
	}
});

test('HTTP, malformed JSON and oversized JWKS failures permit an immediate retry', async () => {
	for (
		const [response, code] of [
			[new Response('Unavailable', { status: 503 }), 'jwks_unavailable'],
			[new Response('{"keys":[],"keys":[]}'), 'jwks_malformed'],
			[new Response(JSON.stringify({ ...document(), padding: ' '.repeat(65_536) })), 'jwks_malformed'],
		] as const
	) {
		let calls = 0;
		const resolver = remoteKeys(endpoint, async () => ++calls === 1 ? response : Response.json(document()));
		expect(await resolver(request())).toMatchObject({ ok: false, code });
		expect((await resolver(request())).ok).toBe(true);
		expect(calls).toBe(2);
	}
});

test('aborted transports cannot populate the cache with a late response', async () => {
	const controller = new AbortController();
	const pending = Promise.withResolvers<Response>();
	const started = Promise.withResolvers<void>();
	let calls = 0;
	const transport: Fetcher = () => {
		if (++calls > 1) return Promise.resolve(Response.json(document('rotated')));
		started.resolve();
		return pending.promise;
	};
	const resolver = remoteKeys(endpoint, transport);
	const first = resolver(request('current', controller.signal));
	await started.promise;
	controller.abort();
	expect(await first).toMatchObject({ ok: false, code: 'aborted' });
	const response = Response.json(document());
	pending.resolve(response);
	await pending.promise;
	expect((await resolver(request('rotated'))).ok).toBe(true);
	expect(calls).toBe(2);
	expect(response.bodyUsed).toBe(true);
});

test('aborting a stalled response body cancels its reader and permits a fresh fetch', async () => {
	const controller = new AbortController();
	const reading = Promise.withResolvers<void>();
	let cancelled = false;
	let calls = 0;
	const response = new Response(new ReadableStream<Uint8Array>(
		{
			pull() {
				reading.resolve();
			},
			cancel() {
				cancelled = true;
			},
		},
		{ highWaterMark: 0 },
	));
	const resolver = remoteKeys(endpoint, async () => ++calls === 1 ? response : Response.json(document()));
	const first = resolver(request('current', controller.signal));
	await reading.promise;
	controller.abort();
	expect(await first).toMatchObject({ ok: false, code: 'aborted' });
	expect(cancelled).toBe(true);
	expect((await resolver(request())).ok).toBe(true);
	expect(calls).toBe(2);
});

test('the signing key deadline cancels both stalled fetches and stalled response bodies', async () => {
	let fetchSignal: AbortSignal | null | undefined;
	let cancelled = false;
	const stalledFetch = remoteKeys(endpoint, (_input, init) => {
		fetchSignal = init?.signal;
		return new Promise<Response>(() => {});
	});
	const stalledBody = remoteKeys(endpoint, async () => new Response(new ReadableStream<Uint8Array>({
		cancel() {
			cancelled = true;
		},
	})));
	const results = await Promise.all([stalledFetch(request()), stalledBody(request())]);
	for (const result of results) expect(result).toMatchObject({ ok: false, code: 'jwks_unavailable' });
	expect(fetchSignal?.aborted).toBe(true);
	expect(cancelled).toBe(true);
}, 10_000);

test.each(['cancellation', 'deadline'] as const)(
	'%s settles cached and fresh key resolution before a late import completes',
	async reason => {
		const cached = remoteKeys(endpoint, async () => Response.json(document()));
		const fresh = remoteKeys(endpoint, async () => Response.json(document()));
		expect((await cached(request())).ok).toBe(true);
		const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
			'verify',
		]);
		const imported = Promise.withResolvers<CryptoKey>();
		const started = Promise.withResolvers<void>();
		let imports = 0;
		const importKey = spyOn(crypto.subtle, 'importKey').mockImplementation(() => {
			if (++imports === 2) started.resolve();
			return imported.promise;
		});
		const controller = new AbortController();
		const resolutions = Promise.all([
			cached(request('current', controller.signal)),
			fresh(request('current', controller.signal)),
		]);
		let guard: ReturnType<typeof setTimeout> | undefined;
		try {
			await started.promise;
			if (reason === 'cancellation') controller.abort();
			const results = await Promise.race([
				resolutions,
				new Promise<undefined>(resolve => {
					guard = setTimeout(() => resolve(undefined), reason === 'cancellation' ? 1000 : 6500);
				}),
			]);
			expect(results).toBeDefined();
			const failure = { ok: false, code: reason === 'cancellation' ? 'aborted' : 'jwks_unavailable' };
			for (const result of results ?? []) expect(result).toMatchObject(failure);
			imported.resolve(key);
			for (const result of await resolutions) expect(result).toMatchObject(failure);
		} finally {
			clearTimeout(guard);
			imported.resolve(key);
			await resolutions;
			importKey.mockRestore();
		}
		expect((await cached(request())).ok).toBe(true);
		expect((await fresh(request())).ok).toBe(true);
	},
	10_000,
);
