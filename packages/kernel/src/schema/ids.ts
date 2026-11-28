import { digestHex } from '@/kernel/crypto/digest.ts';

export const shaPattern = /^[0-9a-f]{40}$/;
export const approvalShaPattern = /^[0-9a-f]{7,40}$/;
export const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;
export const credentialAliasPattern = /^[\w-]{1,64}$/;
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
export function sha256Hex(value: string | ArrayBuffer): Promise<string> {
	return digestHex('SHA-256', value);
}
