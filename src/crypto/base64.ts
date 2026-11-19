export function base64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}
export function bytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
