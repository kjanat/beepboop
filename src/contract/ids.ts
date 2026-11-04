export const shaPattern = /^[0-9a-f]{40}$/;
export const credentialAliasPattern = /^[\w-]{1,64}$/;
export const githubSecretNamePattern = /^[A-Z_][A-Z0-9_]*$/;
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
