import { Effect } from 'effect';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export interface RefPolicy {
	phase: 'version' | 'aliases';
	prefix: string;
	aliases: ('major' | 'minor')[];
	signed: boolean;
	immutable?: boolean;
	distribution?: { files: string[]; ancestry: 'ours' };
}
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
	return fromPromise(() => crypto.subtle.digest('SHA-1', data)).pipe(
		Effect.map(digest => [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')),
	);
}
