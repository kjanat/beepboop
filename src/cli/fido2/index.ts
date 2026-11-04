import { hidAuthenticator } from '@/cli/fido2/ctap';
import { linuxTransport } from '@/cli/fido2/linux';
import { macosTransport } from '@/cli/fido2/macos';
import { sha256 } from '@/cli/fido2/pin';
import type { Authenticator } from '@/cli/fido2/types';
import { windowsAuthenticator } from '@/cli/fido2/windows';
import { array, record, text } from '@/model';

function requestOptions(value: unknown) {
	const options = record(value);
	return {
		challenge: text(options.challenge),
		rpId: options.rpId === undefined ? undefined : text(options.rpId),
		allowCredentials: array(options.allowCredentials ?? []).map(credential => ({ id: text(record(credential).id) })),
	};
}

export interface SecurityKeyPrompts {
	pin(): Promise<string>;
	touch(): void;
}

function authenticator(): Authenticator {
	if (process.platform === 'win32') return windowsAuthenticator;
	if (process.platform === 'darwin') return hidAuthenticator(macosTransport);
	if (process.platform === 'linux') return hidAuthenticator(linuxTransport);
	throw new Error(`Security keys are not supported on ${process.platform}`);
}

const base64url = (data: Uint8Array): string => Buffer.from(data).toString('base64url');

export async function securityKeyAssertion(options: unknown, origin: string, prompts: SecurityKeyPrompts) {
	const request = requestOptions(options);
	const clientDataJSON = new TextEncoder().encode(
		JSON.stringify({ type: 'webauthn.get', challenge: request.challenge, origin, crossOrigin: false }),
	);
	const assertion = await authenticator().getAssertion({
		rpId: request.rpId ?? new URL(origin).hostname,
		clientDataJSON,
		clientDataHash: sha256(clientDataJSON),
		allowCredentials: request.allowCredentials.map(credential =>
			new Uint8Array(Buffer.from(credential.id, 'base64url'))
		),
		pin: prompts.pin,
		touch: prompts.touch,
	});
	const id = base64url(assertion.credentialId);
	return {
		id,
		rawId: id,
		type: 'public-key',
		response: {
			clientDataJSON: base64url(clientDataJSON),
			authenticatorData: base64url(assertion.authenticatorData),
			signature: base64url(assertion.signature),
			...(assertion.userHandle ? { userHandle: base64url(assertion.userHandle) } : {}),
		},
		clientExtensionResults: {},
		authenticatorAttachment: 'cross-platform',
	};
}
