import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Effect, Schema, SchemaGetter } from 'effect';
import type { AuthenticatorStore, SavedCredential, StoredCredential } from '@/auth/adapters/d1/authenticators.ts';
import type { SessionStore } from '@/auth/adapters/d1/sessions.ts';
import { consumeElevation, grantElevation } from '@/auth/elevation.ts';
import type { AuthBindings } from '@/auth/service.ts';
import type { SecurityChallenge } from '@/auth/session-documents.ts';
import { base64, bytes } from '@/kernel/crypto/base64.ts';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeRequest, forbidden, notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { record } from '@/kernel/schema/result.ts';
import { mapped, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

const clientExtensionResults = Schema.Unknown.pipe(
	Schema.decodeTo(mutableStruct({}), {
		decode: SchemaGetter.transform(() => ({})),
		encode: SchemaGetter.transform(() => ({})),
	}),
);
const registrationResponse: Schema.Codec<RegistrationResponseJSON, unknown> = mutableStruct({
	id: Schema.String,
	rawId: Schema.String,
	type: Schema.Literal('public-key'),
	response: mutableStruct({
		clientDataJSON: Schema.String,
		attestationObject: Schema.String,
		authenticatorData: Schema.optional(Schema.String),
		transports: Schema.optional(mutableArray(Schema.String)),
		publicKeyAlgorithm: Schema.optional(Schema.Finite),
		publicKey: Schema.optional(Schema.String),
	}),
	clientExtensionResults,
});
const authenticationResponse: Schema.Codec<AuthenticationResponseJSON, unknown> = mutableStruct({
	id: Schema.String,
	rawId: Schema.String,
	type: Schema.Literal('public-key'),
	response: mutableStruct({
		clientDataJSON: Schema.String,
		authenticatorData: Schema.String,
		signature: Schema.String,
		userHandle: Schema.optional(mapped(
			Schema.NullOr(Schema.String),
			Schema.UndefinedOr(Schema.String),
			value => value ?? undefined,
			value => value ?? null,
		)),
	}),
	clientExtensionResults,
});

export function enrollmentRefusal(register: boolean, enrolled: number): string | undefined {
	return !register && enrolled === 0 ? 'Enroll a security key first.' : undefined;
}

type RegistrationChallenge = Exclude<SecurityChallenge, { kind: 'authenticate' }>;
type SecurityRequest = { kind: 'authenticate' } | {
	kind: 'register';
	label?: string | undefined;
	proof?: string | undefined;
};

export class Authenticators {
	private readonly sessions: SessionStore;
	private readonly store: AuthenticatorStore;
	constructor(private env: AuthBindings, store: AuthenticatorStore, sessions: SessionStore) {
		this.sessions = sessions;
		this.store = store;
	}
	private saved(subject: string): Effect.Effect<StoredCredential[], DomainError> {
		return this.store.saved(subject);
	}
	private credentials(subject: string): Effect.Effect<SavedCredential[], DomainError> {
		return this.saved(subject).pipe(Effect.map(entries => entries.map(entry => entry.credential)));
	}
	options(
		subject: string,
		request: SecurityRequest,
	): Effect.Effect<{ id: string; options: unknown }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const credentials = yield* this.credentials(subject);
			const register = request.kind === 'register';
			const kind = !register ? 'authenticate' : credentials.length === 0 ? 'register-initial' : 'register-additional';
			if (request.kind === 'register' && kind === 'register-additional') {
				yield* this.consume(subject, request.proof ?? '');
			}
			const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
			const refusal = enrollmentRefusal(register, credentials.length);
			if (refusal) return yield* precondition(refusal);
			const options = register
				? yield* fromPromise(() =>
					generateRegistrationOptions({
						rpID,
						rpName: 'Beepboop',
						userName: subject,
						userID: new TextEncoder().encode(subject),
						excludeCredentials: credentials.map((c) => ({ id: c.id })),
						authenticatorSelection: {
							authenticatorAttachment: 'cross-platform',
							userVerification: 'required',
							residentKey: 'discouraged',
						},
						preferredAuthenticatorType: 'securityKey',
						supportedAlgorithmIDs: [-7, -257],
					})
				)
				: yield* fromPromise(() =>
					generateAuthenticationOptions({
						rpID,
						userVerification: 'required',
						allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
					})
				);
			const id = crypto.randomUUID();
			const challenge: SecurityChallenge = {
				kind,
				subject,
				...(request.kind === 'register' && request.label !== undefined ? { label: request.label.slice(0, 80) } : {}),
				challenge: options.challenge,
			};
			yield* this.sessions.open('security-challenge', id, challenge, 120000);
			return { id, options };
		});
	}
	private register(
		subject: string,
		challenge: RegistrationChallenge,
		response: unknown,
		rpID: string,
	): Effect.Effect<{ proof?: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const parsed = yield* decodeRequest(registrationResponse, response);
			const expectedChallenge = challenge.challenge;
			const result = yield* fromPromise(() =>
				verifyRegistrationResponse({
					response: parsed,
					expectedChallenge,
					expectedOrigin: this.env.APPLICATION_ORIGIN,
					expectedRPID: rpID,
					requireUserVerification: true,
					supportedAlgorithmIDs: [-7, -257],
				})
			);
			if (
				!result.verified
				|| result.registrationInfo.credentialBackedUp
				|| result.registrationInfo.credentialDeviceType !== 'singleDevice'
			) {
				return yield* precondition('A physical security key is required');
			}
			const c = result.registrationInfo.credential;
			const credential: SavedCredential = {
				id: c.id,
				publicKey: base64(c.publicKey),
				counter: c.counter,
				...(c.transports === undefined ? {} : { transports: c.transports }),
				...(challenge.label === undefined ? {} : { label: challenge.label }),
			};
			const insert = challenge.kind === 'register-initial'
				? this.store.enrollInitial(subject, credential)
				: this.store.enroll(subject, credential);
			if ((yield* insert).meta.changes !== 1) {
				return yield* precondition('Initial key was already enrolled; authenticate with the existing key');
			}
			return {};
		});
	}
	verify(subject: string, id: string, response: unknown): Effect.Effect<{ proof?: string }, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const challenge = yield* this.sessions.take('security-challenge', id);
			if (challenge === undefined) return yield* forbidden('Challenge expired; request a new security-key challenge');
			if (challenge.subject !== subject) return yield* forbidden('Challenge subject mismatch');
			const rpID = new URL(this.env.APPLICATION_ORIGIN).hostname;
			if (challenge.kind !== 'authenticate') return yield* this.register(subject, challenge, response, rpID);
			const responseId = (yield* Effect.fromResult(record(response))).id;
			const stored = (yield* this.saved(subject)).find((entry) => entry.credential.id === responseId);
			if (!stored) return yield* precondition('Unknown authenticator');
			const saved = stored.credential;
			const parsed = yield* decodeRequest(authenticationResponse, response);
			const expectedChallenge = challenge.challenge;
			const publicKey = yield* fromSync(() => bytes(saved.publicKey));
			const result = yield* fromPromise(() =>
				verifyAuthenticationResponse({
					response: parsed,
					expectedChallenge,
					expectedOrigin: this.env.APPLICATION_ORIGIN,
					expectedRPID: rpID,
					credential: { ...saved, publicKey },
					requireUserVerification: true,
				})
			);
			if (!result.verified) return yield* precondition('Authentication failed');
			const update = yield* this.store.replace(saved.id, stored.document, {
				...saved,
				counter: result.authenticationInfo.newCounter,
			});
			if (update.meta.changes !== 1) return yield* precondition('Authenticator changed during verification');
			return { proof: yield* grantElevation(this.sessions, subject) };
		});
	}
	consume(subject: string, proof: string): Effect.Effect<void, DomainError> {
		return consumeElevation(this.sessions, subject, proof);
	}
	list(subject: string): Effect.Effect<{ id: string; label: string }[], DomainError> {
		return this.credentials(subject).pipe(
			Effect.map(credentials => credentials.map((c) => ({ id: c.id, label: c.label ?? 'Security key' }))),
		);
	}
	removable(subject: string, id: string): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const credentials = yield* this.credentials(subject);
			if (!credentials.some(credential => credential.id === id)) {
				return yield* notFound('security-key', 'Unknown security key', id);
			}
			if (credentials.length < 2) return yield* precondition('Cannot remove the last enrolled key');
		});
	}
	remove(subject: string, id: string): Effect.Effect<void, DomainError> {
		return this.store.remove(subject, id).pipe(
			Effect.filterOrFail(
				result => result.meta.changes === 1,
				() => precondition('Cannot remove the last enrolled key or an unknown key'),
			),
			Effect.asVoid,
		);
	}
}
