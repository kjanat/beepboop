import { createHash } from 'node:crypto';

export function sha256(data: Uint8Array): Uint8Array {
	return new Uint8Array(createHash('sha256').update(data).digest());
}

export function sha256Hex(data: Uint8Array): string {
	return Buffer.from(sha256(data)).toString('hex');
}
