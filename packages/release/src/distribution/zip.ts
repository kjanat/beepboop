import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import { precondition } from '@/kernel/errors/domain-error.ts';

export const maxDistributionFiles = 64;
export const maxDirectoryEntries = 128;
const maxTransportFiles = maxDistributionFiles + 2;

// Read the bounded ZIP produced by actions/upload-artifact without extracting to a filesystem.
export function filesFromZip(bytes: Uint8Array): Map<string, Buffer> {
	const zip = Buffer.from(bytes);
	let end = zip.length - 22;
	for (; end >= Math.max(0, zip.length - 65_557); end--) {
		if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break;
	}
	if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) throw precondition('Invalid distribution ZIP directory');
	const count = zip.readUInt16LE(end + 10);
	const directorySize = zip.readUInt32LE(end + 12);
	let cursor = zip.readUInt32LE(end + 16);
	if (
		zip.readUInt32LE(end + 4) !== 0 || zip.readUInt16LE(end + 8) !== count
		|| cursor + directorySize !== end
	) {
		throw precondition('Unsupported distribution ZIP directory');
	}
	if (count > maxTransportFiles + maxDirectoryEntries) {
		throw precondition(
			'Distribution ZIP exceeds 194 entries (64 distribution files, 2 metadata files, 128 directories)',
		);
	}
	const files = new Map<string, Buffer>();
	let total = 0;
	let directories = 0;
	for (let index = 0; index < count; index++) {
		if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50) {
			throw precondition('Invalid distribution ZIP entry');
		}
		const flags = zip.readUInt16LE(cursor + 8);
		const method = zip.readUInt16LE(cursor + 10);
		const compressedSize = zip.readUInt32LE(cursor + 20);
		const size = zip.readUInt32LE(cursor + 24);
		const nameSize = zip.readUInt16LE(cursor + 28);
		const entryEnd = cursor + 46 + nameSize + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
		const local = zip.readUInt32LE(cursor + 42);
		if (entryEnd > end || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) {
			throw precondition('Invalid distribution ZIP offsets');
		}
		const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameSize);
		const name = nameBytes.toString('utf8');
		const localNameSize = zip.readUInt16LE(local + 26);
		const start = local + 30 + localNameSize + zip.readUInt16LE(local + 28);
		const mode = zip.readUInt32LE(cursor + 38) >>> 16;
		if (
			(flags & 1) || (method !== 0 && method !== 8) || start + compressedSize > zip.readUInt32LE(end + 16)
			|| !nameBytes.equals(zip.subarray(local + 30, local + 30 + localNameSize))
			|| zip.readUInt16LE(local + 8) !== method || zip.readUInt16LE(local + 6) !== flags
			|| (mode & 0o170000) === 0o120000 || files.has(name)
			|| name.startsWith('/') || name.includes('\\') || name.includes('\0')
			|| name.split('/').some(part => part === '.' || part === '..' || part.toLowerCase() === '.git')
		) throw precondition('Unsupported distribution ZIP entry');
		cursor = entryEnd;
		if (name.endsWith('/')) {
			if (++directories > maxDirectoryEntries) throw precondition('Distribution ZIP exceeds 128 directory entries');
			continue;
		}
		if (files.size >= maxTransportFiles) throw precondition('Distribution ZIP exceeds 66 file entries');
		total += size;
		if (total > 16 * 1024 * 1024) throw precondition('Unpacked distribution exceeds 16 MiB');
		const compressed = zip.subarray(start, start + compressedSize);
		const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
		if (content.byteLength !== size) throw precondition('Distribution ZIP size mismatch');
		files.set(name, content);
	}
	if (cursor !== end) throw precondition('Invalid distribution ZIP directory size');
	return files;
}
