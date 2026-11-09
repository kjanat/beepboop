import {
	createCipheriv,
	createDecipheriv,
	createECDH,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
} from 'node:crypto';
import { Result } from 'effect';
import type { CborMap } from '@/cli/fido2/cbor';
import { bytes } from '@/cli/fido2/cbor';
import type { SecurityKeyError } from '@/cli/fido2/types';
import { securityKeyFailure } from '@/cli/fido2/types';

export interface PinProtocol {
	readonly version: 1 | 2;
	readonly platformKey: CborMap;
	encrypt(data: Uint8Array): Result.Result<Uint8Array, SecurityKeyError>;
	decrypt(data: Uint8Array): Result.Result<Uint8Array, SecurityKeyError>;
	authenticate(key: Uint8Array, message: Uint8Array): Uint8Array;
}

function crypto<A>(run: () => A): Result.Result<A, SecurityKeyError> {
	return Result.try({ try: run, catch: securityKeyFailure });
}

function aes(
	decrypt: boolean,
	key: Uint8Array,
	iv: Uint8Array,
	data: Uint8Array,
): Result.Result<Uint8Array, SecurityKeyError> {
	return crypto(() => {
		const cipher = decrypt ? createDecipheriv('aes-256-cbc', key, iv) : createCipheriv('aes-256-cbc', key, iv);
		cipher.setAutoPadding(false);
		return new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
	});
}

function hmac(key: Uint8Array, message: Uint8Array): Uint8Array {
	return new Uint8Array(createHmac('sha256', key).update(message).digest());
}

export function sha256(data: Uint8Array): Uint8Array {
	return new Uint8Array(createHash('sha256').update(data).digest());
}

export function pinProtocol(version: 1 | 2, authenticatorKey: CborMap): Result.Result<PinProtocol, SecurityKeyError> {
	return Result.gen(function*() {
		const ecdh = createECDH('prime256v1');
		const ownKey = new Uint8Array(ecdh.generateKeys());
		const peer = Uint8Array.from([
			0x04,
			...yield* bytes(authenticatorKey.get(-2)),
			...yield* bytes(authenticatorKey.get(-3)),
		]);
		const z = yield* crypto(() => new Uint8Array(ecdh.computeSecret(peer)));
		// COSE_Key for ECDH-ES+HKDF-256 on P-256, from CTAP 2.1 section 6.5.6.
		const platformKey: CborMap = new Map<number, number | Uint8Array>([
			[1, 2],
			[3, -25],
			[-1, 1],
			[-2, ownKey.slice(1, 33)],
			[-3, ownKey.slice(33, 65)],
		]);
		if (version === 1) {
			const shared = sha256(z), zero = new Uint8Array(16);
			return {
				version,
				platformKey,
				encrypt: data => aes(false, shared, zero, data),
				decrypt: data => aes(true, shared, zero, data),
				authenticate: (key, message) => hmac(key, message).slice(0, 16),
			};
		}
		const salt = new Uint8Array(32);
		const aesKey = yield* crypto(() => new Uint8Array(hkdfSync('sha256', z, salt, 'CTAP2 AES key', 32)));
		return {
			version,
			platformKey,
			encrypt: data => {
				const iv = new Uint8Array(randomBytes(16));
				return aes(false, aesKey, iv, data).pipe(Result.map(encrypted => Uint8Array.from([...iv, ...encrypted])));
			},
			decrypt: data => aes(true, aesKey, data.slice(0, 16), data.slice(16)),
			authenticate: (key, message) => hmac(key, message),
		};
	});
}
