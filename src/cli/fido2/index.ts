import { Effect } from 'effect';
import { hidAuthenticator } from '@/cli/fido2/ctap';
import { linuxTransport } from '@/cli/fido2/linux';
import { macosTransport } from '@/cli/fido2/macos';
import { sha256 } from '@/cli/fido2/pin';
import { type Authenticator, SecurityKeyError } from '@/cli/fido2/types';
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

export interface SecurityKeyPrompts<E = never> {
	pin: Effect.Effect<string, E>;
	touch(): void;
}

function authenticator(): Effect.Effect<Authenticator, SecurityKeyError> {
	if (process.platform === 'win32') return Effect.succeed(windowsAuthenticator);
	if (process.platform === 'darwin') return Effect.succeed(hidAuthenticator(macosTransport));
	if (process.platform === 'linux') return Effect.succeed(hidAuthenticator(linuxTransport));
	return Effect.fail(new SecurityKeyError({ message: `Security keys are not supported on ${process.platform}` }));
}

const base64url = (data: Uint8Array): string => Buffer.from(data).toString('base64url');

export const securityKeyAssertion = Effect.fn('securityKeyAssertion')(function*<E>(
	options: unknown,
	origin: string,
	prompts: SecurityKeyPrompts<E>,
) {
	const request = requestOptions(options);
	const clientDataJSON = new TextEncoder().encode(
		JSON.stringify({ type: 'webauthn.get', challenge: request.challenge, origin, crossOrigin: false }),
	);
	const assertion = yield* (yield* authenticator()).getAssertion({
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
});
