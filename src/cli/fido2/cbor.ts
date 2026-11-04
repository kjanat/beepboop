export type CborValue = number | string | boolean | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<number | string, CborValue>;

function head(major: number, length: number): number[] {
	if (length < 24) return [(major << 5) | length];
	if (length < 0x100) return [(major << 5) | 24, length];
	if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
	return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
}

function keyOrder(left: number | string, right: number | string): number {
	const a = encode(left), b = encode(right);
	return a.length - b.length || a.reduce((order, byte, index) => order || byte - (b[index] ?? 0), 0);
}

export function encode(value: CborValue): Uint8Array {
	const bytes: number[] = [];
	const write = (item: CborValue): void => {
		if (typeof item === 'number') {
			if (!Number.isSafeInteger(item)) throw new Error('CBOR encoder supports integers only');
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
			for (const entry of item) write(entry);
		} else {
			const keys = [...item.keys()].sort(keyOrder);
			bytes.push(...head(5, keys.length));
			for (const key of keys) {
				const entry = item.get(key);
				if (entry === undefined) continue;
				write(key);
				write(entry);
			}
		}
	};
	write(value);
	return Uint8Array.from(bytes);
}

export function decode(input: Uint8Array): CborValue {
	let offset = 0;
	const byte = (): number => {
		const value = input[offset++];
		if (value === undefined) throw new Error('Truncated CBOR');
		return value;
	};
	const length = (info: number): number => {
		if (info < 24) return info;
		if (info === 24) return byte();
		if (info === 25) return (byte() << 8) | byte();
		if (info === 26) return ((byte() << 24) >>> 0) + ((byte() << 16) | (byte() << 8) | byte());
		if (info === 27) {
			const high = ((byte() << 24) >>> 0) + ((byte() << 16) | (byte() << 8) | byte());
			const low = ((byte() << 24) >>> 0) + ((byte() << 16) | (byte() << 8) | byte());
			const value = high * 2 ** 32 + low;
			if (!Number.isSafeInteger(value)) throw new Error('CBOR integer too large');
			return value;
		}
		throw new Error('Unsupported CBOR length');
	};
	const take = (count: number): Uint8Array => {
		if (offset + count > input.length) throw new Error('Truncated CBOR');
		const slice = input.slice(offset, offset + count);
		offset += count;
		return slice;
	};
	const read = (): CborValue => {
		const initial = byte(), major = initial >> 5, info = initial & 0x1f;
		if (major === 0) return length(info);
		if (major === 1) return -1 - length(info);
		if (major === 2) return take(length(info));
		if (major === 3) return new TextDecoder().decode(take(length(info)));
		if (major === 4) return Array.from({ length: length(info) }, read);
		if (major === 5) {
			const map: CborMap = new Map();
			for (let index = length(info); index > 0; index--) {
				const key = read();
				if (typeof key !== 'number' && typeof key !== 'string') throw new Error('Unsupported CBOR map key');
				map.set(key, read());
			}
			return map;
		}
		if (major === 6) {
			length(info);
			return read();
		}
		if (initial === 0xf4) return false;
		if (initial === 0xf5) return true;
		throw new Error('Unsupported CBOR value');
	};
	return read();
}

export function map(value: CborValue | undefined): CborMap {
	if (value instanceof Map) return value;
	throw new Error('Expected a CBOR map');
}

export function bytes(value: CborValue | undefined): Uint8Array {
	if (value instanceof Uint8Array) return value;
	throw new Error('Expected CBOR bytes');
}
