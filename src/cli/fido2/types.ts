export interface HidDevice {
	readonly path: string;
	write(report: Uint8Array): Promise<void>;
	read(timeoutMs: number): Promise<Uint8Array>;
	close(): void;
}

export interface HidTransport {
	devices(): Promise<HidDevice[]>;
}

export interface AssertionRequest {
	rpId: string;
	clientDataJSON: Uint8Array;
	clientDataHash: Uint8Array;
	allowCredentials: Uint8Array[];
	pin(): Promise<string>;
	touch(): void;
}

export interface Assertion {
	credentialId: Uint8Array;
	authenticatorData: Uint8Array;
	signature: Uint8Array;
	userHandle?: Uint8Array;
}

export interface Authenticator {
	getAssertion(request: AssertionRequest): Promise<Assertion>;
}
