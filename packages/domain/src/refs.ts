import type { Effect } from 'effect';
import { Schema } from 'effect';
import { digestHex } from '@/kernel/crypto/digest.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { stringsSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct, refined } from '@/kernel/schema/structs.ts';

export const refPolicyValue = refined(
	mutableStruct({
		phase: Schema.Literals(['version', 'aliases']),
		prefix: Schema.String,
		aliases: mutableArray(Schema.Literals(['major', 'minor'])),
		signed: Schema.Boolean,
		immutable: Schema.optional(Schema.Boolean),
		distribution: Schema.optional(mutableStruct({ files: stringsSchema, ancestry: Schema.Literal('ours') })),
	}),
	value => !value.distribution || (value.phase === 'version' && value.signed && value.immutable === true),
	'Distribution publication requires signed version refs and immutable Releases',
);
export type RefPolicy = Decoded<typeof refPolicyValue>;
export interface RefState {
	name: string;
	oid: string;
	commit: string;
}
export interface RefChange {
	name: string;
	expected: string | null;
	commit: string;
	annotated: boolean;
	signed: boolean;
	object?: string;
	replaces?: boolean;
}
export interface DistributionEvidence {
	sourceSha: string;
	commit: string;
	tree: string;
	ancestryCommit: string;
	branch: string;
	expected: string;
}
export interface RefPlan {
	distribution?: DistributionEvidence;
	repository: string;
	executionId: string;
	version: string;
	changes: RefChange[];
	publicKey?: string;
}
export interface SigningIdentity {
	publicKey: string;
	userId: string;
}
/** The `Signer` RPC entrypoint of gpg-signing-service. */
export interface TagSigner {
	identity(): Promise<SigningIdentity>;
	sign(data: string, caller: string): Promise<string>;
}
export function tagObject(change: RefChange, version: string, tagger: string, signature: string): string {
	return `${tagPayload(change, `Release ${version}`, tagger)}${
		signature.endsWith('\n') ? signature : `${signature}\n`
	}`;
}
export function tagPayload(change: RefChange, message: string, tagger: string): string {
	return `object ${change.commit}\ntype commit\ntag ${change.name}\ntagger ${tagger}\n\n${message}\n`;
}
export interface ModuleTag {
	id: string;
	prefix: string;
}
export function tagObjectId(object: string): Effect.Effect<string, DomainError> {
	const bytes = new TextEncoder().encode(object);
	const header = new TextEncoder().encode(`tag ${bytes.length}\0`);
	const data = new Uint8Array(header.length + bytes.length);
	data.set(header);
	data.set(bytes, header.length);
	return fromPromise(() => digestHex('SHA-1', data));
}
