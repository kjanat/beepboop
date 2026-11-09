import type { Pointer } from 'bun:ffi';
import { dlopen, FFIType, ptr, read, toArrayBuffer } from 'bun:ffi';
import type { Scope } from 'effect';
import { Effect } from 'effect';
import type { Assertion, AssertionRequest, Authenticator } from '@/cli/fido2/types';
import { SecurityKeyError, securityKeyFailure } from '@/cli/fido2/types';

const CLIENT_DATA_VERSION = 1;
const CREDENTIAL_VERSION = 1;
const OPTIONS_VERSION = 1;
const TIMEOUT_MILLISECONDS = 120000;
// WEBAUTHN_AUTHENTICATOR_ATTACHMENT_CROSS_PLATFORM
const ATTACHMENT_CROSS_PLATFORM = 2;
// WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED
const USER_VERIFICATION_REQUIRED = 1;
// WEBAUTHN_CLIENT_DATA: version 0, cbClientDataJSON 4, pbClientDataJSON 8, pwszHashAlgId 16.
const CLIENT_DATA_SIZE = 24;
// WEBAUTHN_CREDENTIAL: version 0, cbId 4, pbId 8, pwszCredentialType 16.
const CREDENTIAL_SIZE = 24;
// GET_ASSERTION_OPTIONS v1: version 0, timeout 4, CredentialList 8 (count 8, pointer 16), Extensions 24, attachment 40, userVerification 44, flags 48.
const OPTIONS_SIZE = 56;
// WEBAUTHN_ASSERTION v1: cbAuthenticatorData 4, pbAuthenticatorData 8, cbSignature 16, pbSignature 24, Credential 32 (cbId 36, pbId 40), cbUserId 56, pbUserId 64.
const ASSERTION_SIZE = 72;
const ERROR_NAME_LIMIT = 256;

function wide(text: string): Uint16Array {
	const units = new Uint16Array(text.length + 1);
	for (let index = 0; index < text.length; index++) units[index] = text.charCodeAt(index);
	return units;
}

function setPointer(view: DataView, offset: number, target: Uint8Array | Uint16Array | ArrayBuffer): void {
	view.setBigUint64(offset, BigInt(ptr(target)), true);
}

function clientData(json: Uint8Array, algorithm: Uint16Array): ArrayBuffer {
	const buffer = new ArrayBuffer(CLIENT_DATA_SIZE);
	const view = new DataView(buffer);
	view.setUint32(0, CLIENT_DATA_VERSION, true);
	view.setUint32(4, json.byteLength, true);
	setPointer(view, 8, json);
	setPointer(view, 16, algorithm);
	return buffer;
}

function credentials(ids: Uint8Array[], type: Uint16Array): ArrayBuffer {
	const buffer = new ArrayBuffer(CREDENTIAL_SIZE * ids.length);
	const view = new DataView(buffer);
	ids.forEach((id, index) => {
		const base = index * CREDENTIAL_SIZE;
		view.setUint32(base, CREDENTIAL_VERSION, true);
		view.setUint32(base + 4, id.byteLength, true);
		setPointer(view, base + 8, id);
		setPointer(view, base + 16, type);
	});
	return buffer;
}

function options(count: number, list: ArrayBuffer): ArrayBuffer {
	const buffer = new ArrayBuffer(OPTIONS_SIZE);
	const view = new DataView(buffer);
	view.setUint32(0, OPTIONS_VERSION, true);
	view.setUint32(4, TIMEOUT_MILLISECONDS, true);
	view.setUint32(8, count, true);
	if (count > 0) setPointer(view, 16, list);
	view.setUint32(40, ATTACHMENT_CROSS_PLATFORM, true);
	view.setUint32(44, USER_VERIFICATION_REQUIRED, true);
	return buffer;
}

function copyBytes(view: DataView, lengthOffset: number, pointerOffset: number): Uint8Array {
	const length = view.getUint32(lengthOffset, true);
	const address = Number(view.getBigUint64(pointerOffset, true));
	if (length === 0 || address === 0) return new Uint8Array(0);
	return new Uint8Array(toArrayBuffer(address, 0, length)).slice();
}

function errorName(address: Pointer | bigint | null): string | undefined {
	if (address === null) return undefined;
	const base = Number(address);
	let name = '';
	for (let index = 0; index < ERROR_NAME_LIMIT; index++) {
		const unit = read.u16(base, index * 2);
		if (unit === 0) return name.length > 0 ? name : undefined;
		name += String.fromCharCode(unit);
	}
	return name;
}

function library<A extends { close(): void }>(open: () => A): Effect.Effect<A, SecurityKeyError, Scope.Scope> {
	return Effect.acquireRelease(
		Effect.try({ try: open, catch: securityKeyFailure }),
		handle => Effect.sync(() => handle.close()),
	);
}

function refuse(message: string): Effect.Effect<never, SecurityKeyError> {
	return Effect.fail(new SecurityKeyError({ message }));
}

export const windowsAuthenticator: Authenticator = {
	getAssertion: request =>
		Effect.scoped(Effect.gen(function*() {
			if (process.platform !== 'win32') return yield* refuse('Windows WebAuthn is only available on Windows');
			const webauthn = yield* library(openWebAuthn);
			const user32 = yield* library(() =>
				dlopen('user32.dll', { GetForegroundWindow: { args: [], returns: FFIType.ptr } })
			);
			const kernel32 = yield* library(() =>
				dlopen('kernel32.dll', { GetConsoleWindow: { args: [], returns: FFIType.ptr } })
			);
			if (webauthn.symbols.WebAuthNGetApiVersionNumber() < OPTIONS_VERSION) {
				return yield* refuse('Windows WebAuthn API is too old');
			}
			const handle = yield* Effect.acquireRelease(
				Effect.suspend(() =>
					requestAssertion(
						webauthn.symbols,
						user32.symbols.GetForegroundWindow() ?? kernel32.symbols.GetConsoleWindow(),
						request,
					)
				),
				assertion => Effect.sync(() => webauthn.symbols.WebAuthNFreeAssertion(assertion)),
			);
			return yield* readAssertion(handle);
		})),
};

function openWebAuthn() {
	return dlopen('webauthn.dll', {
		WebAuthNGetApiVersionNumber: { args: [], returns: FFIType.u32 },
		WebAuthNAuthenticatorGetAssertion: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
			returns: FFIType.i32,
		},
		WebAuthNGetErrorName: { args: [FFIType.i32], returns: FFIType.ptr },
		WebAuthNFreeAssertion: { args: [FFIType.ptr], returns: FFIType.void },
	});
}
type WebAuthn = ReturnType<typeof openWebAuthn>['symbols'];

function requestAssertion<E>(
	webauthn: WebAuthn,
	window: Parameters<WebAuthn['WebAuthNAuthenticatorGetAssertion']>[0],
	request: AssertionRequest<E>,
): Effect.Effect<bigint, SecurityKeyError> {
	return Effect.gen(function*() {
		const retained: (Uint8Array | Uint16Array | ArrayBuffer)[] = [];
		const keep = <T extends Uint8Array | Uint16Array | ArrayBuffer>(value: T): T => {
			retained.push(value);
			return value;
		};
		const rpId = keep(wide(request.rpId));
		const algorithm = keep(wide('SHA-256'));
		const type = keep(wide('public-key'));
		const json = keep(request.clientDataJSON.slice());
		const ids = request.allowCredentials.map((id) => keep(id.slice()));
		const data = keep(clientData(json, algorithm));
		const list = keep(credentials(ids, type));
		const settings = keep(options(ids.length, list));
		const output = keep(new ArrayBuffer(8));

		request.touch();
		const result = webauthn.WebAuthNAuthenticatorGetAssertion(
			window,
			ptr(rpId),
			ptr(data),
			ptr(settings),
			ptr(output),
		);
		retained.length = 0;
		if (result !== 0) {
			const name = errorName(webauthn.WebAuthNGetErrorName(result));
			return yield* refuse(name ?? `WebAuthn failed with HRESULT 0x${(result >>> 0).toString(16).padStart(8, '0')}`);
		}
		const handle = new DataView(output).getBigUint64(0, true);
		if (Number(handle) === 0) return yield* refuse('WebAuthn returned no assertion');
		return handle;
	});
}

function readAssertion(handle: bigint): Effect.Effect<Assertion, SecurityKeyError> {
	return Effect.gen(function*() {
		const view = yield* Effect.try({
			try: () => new DataView(toArrayBuffer(Number(handle), 0, ASSERTION_SIZE)),
			catch: securityKeyFailure,
		});
		const authenticatorData = copyBytes(view, 4, 8);
		const signature = copyBytes(view, 16, 24);
		const credentialId = copyBytes(view, 36, 40);
		const userHandle = copyBytes(view, 56, 64);
		if (authenticatorData.byteLength === 0 || signature.byteLength === 0 || credentialId.byteLength === 0) {
			return yield* refuse('WebAuthn returned an incomplete assertion');
		}
		return userHandle.byteLength > 0
			? { credentialId, authenticatorData, signature, userHandle }
			: { credentialId, authenticatorData, signature };
	});
}
