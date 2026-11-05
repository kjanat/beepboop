import { Effect, Result } from 'effect';
import { hidAuthenticator } from '@/cli/fido2/ctap';
import { linuxTransport } from '@/cli/fido2/linux';
import { macosTransport } from '@/cli/fido2/macos';
import { sha256 } from '@/cli/fido2/pin';
import { type Authenticator, SecurityKeyError } from '@/cli/fido2/types';
import { windowsAuthenticator } from '@/cli/fido2/windows';
import { array, type Parsed, record, text } from '@/model';

interface RequestOptions {
	challenge: string;
	rpId: string | undefined;
	allowCredentials: { id: string }[];
}

function credentialId(value: unknown): Parsed<{ id: string }> {
	return Result.gen(function*() {
		return { id: yield* text((yield* record(value)).id) };
	});
}

function requestOptions(value: unknown): Parsed<RequestOptions> {
	return Result.gen(function*() {
		const options = yield* record(value);
		return {
			challenge: yield* text(options.challenge),
			rpId: options.rpId === undefined ? undefined : yield* text(options.rpId),
			allowCredentials: yield* Result.all((yield* array(options.allowCredentials ?? [])).map(credentialId)),
		};
	});
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
	const request = yield* Effect.fromResult(requestOptions(options)).pipe(
		Effect.mapError(error => new SecurityKeyError({ message: `Invalid security key request: ${error.message}` })),
	);
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
