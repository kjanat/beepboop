import { Result } from 'effect';
import type { SecurityKeyError } from '@/cli/fido2/types';
import { rejectSecurityKey } from '@/cli/fido2/types';

export type CborValue = number | string | boolean | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<number | string, CborValue>;
type Decoded<A> = Result.Result<A, SecurityKeyError>;

function head(major: number, length: number): number[] {
	if (length < 24) return [(major << 5) | length];
	if (length < 0x100) return [(major << 5) | 24, length];
	if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
	return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
}

function keyOrder(left: number | string, right: number | string): number {
	const a = Result.getOrElse(encode(left), () => new Uint8Array());
	const b = Result.getOrElse(encode(right), () => new Uint8Array());
	return a.length - b.length || a.reduce((order, byte, index) => order || byte - (b[index] ?? 0), 0);
}

export function encode(value: CborValue): Decoded<Uint8Array> {
	const bytes: number[] = [];
	const write = (item: CborValue): Decoded<void> =>
		Result.gen(function*() {
			if (typeof item === 'number') {
				if (!Number.isSafeInteger(item)) return yield* rejectSecurityKey('CBOR encoder supports integers only');
				bytes.push(...(item >= 0 ? head(0, item) : head(1, -1 - item)));
			} else if (typeof item === 'string') {
				const text = new TextEncoder().encode(item);
				bytes.push(...head(3, text.length), ...text);
			} else if (typeof item === 'boolean') {
				bytes.push(item ? 0xf5 : 0xf4);
			} else if (item instanceof Uint8Array) {
				bytes.push(...head(2, item.length), ...item);
			} else if (Array.isArray(item)) {
				bytes.push(...head(4, item.length));
				for (const entry of item) yield* write(entry);
			} else {
				const keys = [...item.keys()].sort(keyOrder);
				bytes.push(...head(5, keys.length));
				for (const key of keys) {
					const entry = item.get(key);
					if (entry === undefined) continue;
					yield* write(key);
					yield* write(entry);
				}
			}
		});
	return write(value).pipe(Result.map(() => Uint8Array.from(bytes)));
}

export function decode(input: Uint8Array): Decoded<CborValue> {
	let offset = 0;
	const byte = (): Decoded<number> => {
		const value = input[offset++];
		return value === undefined ? rejectSecurityKey('Truncated CBOR') : Result.succeed(value);
	};
	const word = (): Decoded<number> =>
		Result.gen(function*() {
			const [a, b, c, d] = [yield* byte(), yield* byte(), yield* byte(), yield* byte()];
			return ((a << 24) >>> 0) + ((b << 16) | (c << 8) | d);
		});
	const length = (info: number): Decoded<number> =>
		Result.gen(function*() {
			if (info < 24) return info;
			if (info === 24) return yield* byte();
			if (info === 25) return ((yield* byte()) << 8) | (yield* byte());
			if (info === 26) return yield* word();
			if (info === 27) {
				const high = yield* word();
				const low = yield* word();
				const value = high * 2 ** 32 + low;
				if (!Number.isSafeInteger(value)) return yield* rejectSecurityKey('CBOR integer too large');
				return value;
			}
			return yield* rejectSecurityKey('Unsupported CBOR length');
		});
	const take = (count: number): Decoded<Uint8Array> => {
		if (offset + count > input.length) return rejectSecurityKey('Truncated CBOR');
		const slice = input.slice(offset, offset + count);
		offset += count;
		return Result.succeed(slice);
	};
	const read = (): Decoded<CborValue> =>
		Result.gen(function*() {
			const initial = yield* byte(), major = initial >> 5, info = initial & 0x1f;
			if (major === 0) return yield* length(info);
			if (major === 1) return -1 - (yield* length(info));
			if (major === 2) return yield* take(yield* length(info));
			if (major === 3) return new TextDecoder().decode(yield* take(yield* length(info)));
			if (major === 4) {
				const items: CborValue[] = [];
				for (let index = yield* length(info); index > 0; index--) items.push(yield* read());
				return items;
			}
			if (major === 5) {
				const map: CborMap = new Map();
				for (let index = yield* length(info); index > 0; index--) {
					const key = yield* read();
					if (typeof key !== 'number' && typeof key !== 'string') {
						return yield* rejectSecurityKey('Unsupported CBOR map key');
					}
					map.set(key, yield* read());
				}
				return map;
			}
			if (major === 6) {
				yield* length(info);
				return yield* read();
			}
			if (initial === 0xf4) return false;
			if (initial === 0xf5) return true;
			return yield* rejectSecurityKey('Unsupported CBOR value');
		});
	return read();
}

export function map(value: CborValue | undefined): Decoded<CborMap> {
	return value instanceof Map ? Result.succeed(value) : rejectSecurityKey('Expected a CBOR map');
}

export function bytes(value: CborValue | undefined): Decoded<Uint8Array> {
	return value instanceof Uint8Array ? Result.succeed(value) : rejectSecurityKey('Expected CBOR bytes');
}
