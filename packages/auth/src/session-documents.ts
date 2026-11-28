import { Schema } from 'effect';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

const challengeFields = { subject: Schema.String, challenge: Schema.String };
const registrationFields = { ...challengeFields, label: Schema.optional(Schema.String) };
export const securityChallenge = Schema.Union([
	mutableStruct({ kind: Schema.Literal('authenticate'), ...challengeFields }),
	mutableStruct({ kind: Schema.Literal('register-initial'), ...registrationFields }),
	mutableStruct({ kind: Schema.Literal('register-additional'), ...registrationFields }),
]);
export type SecurityChallenge = Decoded<typeof securityChallenge>;

export const loginFlow = mutableStruct({
	state: Schema.String,
	verifier: Schema.String,
	cli: Schema.NullOr(Schema.String),
	return: Schema.String,
});
export type LoginFlow = Decoded<typeof loginFlow>;

export const sessionDocuments = {
	'login-flow': loginFlow,
	'security-challenge': securityChallenge,
	elevation: mutableStruct({ subject: Schema.String, elevated: Schema.Literal(true) }),
	'cli-approval': mutableStruct({ subject: Schema.String }),
} as const;
export type SessionKind = keyof typeof sessionDocuments;
export type SessionDocument<K extends SessionKind> = Decoded<(typeof sessionDocuments)[K]>;
