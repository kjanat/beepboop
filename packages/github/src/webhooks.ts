import { Effect, Schema } from 'effect';
import { onboardingBranch, updateBranch } from '@/domain/setup-branches.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { matchesPattern, mutableStruct } from '@/kernel/schema/structs.ts';

export function verifySignature(
	body: Uint8Array,
	signature: string | null,
	secret: string,
): Effect.Effect<boolean, DomainError> {
	if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return Effect.succeed(false);
	const bytes = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		bytes[i] = Number.parseInt(signature.slice(7 + 2 * i, 9 + 2 * i), 16);
	}
	return fromPromise(() =>
		crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
			'verify',
		])
	).pipe(Effect.flatMap(key => fromPromise(() => crypto.subtle.verify('HMAC', key, bytes, new Uint8Array(body)))));
}

export const setupPullEdit = mutableStruct({
	action: Schema.Literal('edited'),
	changes: mutableStruct({ body: mutableStruct({ from: Schema.NullOr(Schema.String) }) }),
	sender: mutableStruct({ id: Schema.Finite }),
	pull_request: mutableStruct({
		number: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
		state: Schema.Literal('open'),
		body: Schema.NullOr(Schema.String),
		user: mutableStruct({ id: Schema.Finite }),
		head: mutableStruct({
			ref: Schema.Literals([onboardingBranch, updateBranch]),
			sha: Schema.String.check(matchesPattern(shaPattern)),
			repo: mutableStruct({ id: Schema.Finite }),
		}),
		base: mutableStruct({ repo: mutableStruct({ id: Schema.Finite }) }),
	}),
});
export type SetupPullEdit = Decoded<typeof setupPullEdit>;

export const setupPullMerge = mutableStruct({
	action: Schema.Literal('closed'),
	pull_request: mutableStruct({
		number: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
		merged: Schema.Literal(true),
		merge_commit_sha: Schema.String.check(matchesPattern(shaPattern)),
		user: mutableStruct({ id: Schema.Finite }),
		merged_by: mutableStruct({ id: Schema.Finite, login: Schema.String }),
		head: mutableStruct({
			ref: Schema.Literals([onboardingBranch, updateBranch]),
			repo: mutableStruct({ id: Schema.Finite }),
		}),
		base: mutableStruct({ repo: mutableStruct({ id: Schema.Finite }) }),
	}),
});
export type SetupPullMerge = Decoded<typeof setupPullMerge>;

export const inboxEvent = Schema.Union([
	mutableStruct({ kind: Schema.Literal('push'), ref: Schema.String }),
	mutableStruct({ kind: Schema.Literal('release'), action: Schema.String, tag: Schema.optional(Schema.String) }),
	mutableStruct({
		kind: Schema.Literal('workflow_run'),
		action: Schema.String,
		run: mutableStruct({
			id: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
			conclusion: Schema.NullOr(Schema.String),
			event: Schema.String,
			path: Schema.String,
			headRepositoryId: Schema.NullOr(Schema.Finite.check(Schema.isInt())),
		}),
	}),
	mutableStruct({ kind: Schema.Literal('pull_request'), edit: setupPullEdit }),
	mutableStruct({ kind: Schema.Literal('setup_merged'), merge: setupPullMerge }),
]);
export type InboxEvent = Decoded<typeof inboxEvent>;
