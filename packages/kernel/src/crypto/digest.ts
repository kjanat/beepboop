export function hex(bytes: Uint8Array): string {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestHex(algorithm: 'SHA-1' | 'SHA-256', data: string | BufferSource): Promise<string> {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return hex(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)));
}
