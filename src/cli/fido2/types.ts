import { Data, Effect } from 'effect';
import { attemptWith, errorMessage, failWith, rejectWith } from '@/refusal';

export class SecurityKeyError extends Data.TaggedError('SecurityKeyError')<{
	readonly message: string;
	readonly code?: number;
}> {}

function securityKeyError(message: string): SecurityKeyError {
	return new SecurityKeyError({ message });
}

export function securityKeyFailure(error: unknown): SecurityKeyError {
	return securityKeyError(errorMessage(error));
}

export const refuseSecurityKey = failWith(securityKeyError);
export const rejectSecurityKey = rejectWith(securityKeyError);
export const attemptSecurityKey = attemptWith(securityKeyError);

export interface HidDevice {
	readonly path: string;
	write(report: Uint8Array): Effect.Effect<void, SecurityKeyError>;
	read(timeoutMs: number): Effect.Effect<Uint8Array, SecurityKeyError>;
	close(): void;
}

export function closeAll(devices: readonly HidDevice[]): Effect.Effect<void> {
	return Effect.sync(() => {
		for (const device of devices) device.close();
	});
}

export interface HidTransport {
	readonly devices: Effect.Effect<HidDevice[], SecurityKeyError>;
}

export interface AssertionRequest<E = never> {
	rpId: string;
	clientDataJSON: Uint8Array;
	clientDataHash: Uint8Array;
	allowCredentials: Uint8Array[];
	pin: Effect.Effect<string, E>;
	touch(): void;
}

export interface Assertion {
	credentialId: Uint8Array;
	authenticatorData: Uint8Array;
	signature: Uint8Array;
	userHandle?: Uint8Array;
}

export interface Authenticator {
	getAssertion<E>(request: AssertionRequest<E>): Effect.Effect<Assertion, SecurityKeyError | E>;
}
