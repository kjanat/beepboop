export const shaPattern = /^[0-9a-f]{40}$/;
export const approvalShaPattern = /^[0-9a-f]{7,40}$/;
export const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
export const credentialAliasPattern = /^[\w:\x2d]{1,64}$/;
export const credentialAliasDescription = 'Use 1\u201364 letters, digits, underscores, hyphens, or colons.';
export const notificationDestinationIdPattern = /^[\w-]{1,64}$/;
export const sha256HexPattern = /^[a-f0-9]{64}$/;
export const githubSecretNamePattern = /^[A-Z_][A-Z0-9_]*$/;
export const identifierPattern = /^[a-z][a-z0-9-]{0,63}$/;
export const loginSecretPattern = /^[a-f0-9]{64}$/;
export const cliTokenPattern = /^cli_[a-f0-9]{64}$/;

export function loginSecret(): string {
	return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}
export function cliToken(): string {
	return `cli_${loginSecret()}`;
}
export function confirmationCode(challenge: string): string {
	return challenge.slice(0, 8);
}
export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
		.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
