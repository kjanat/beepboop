import { Schema } from 'effect';
import { setupPullEdit, setupPullMerge } from '@/github/webhooks.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

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

export const inboxEntry = mutableStruct({
	delivery: Schema.String.check(Schema.isMinLength(1)),
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	event: inboxEvent,
	attempts: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
	due: Schema.Finite,
	error: Schema.optional(Schema.String),
});
export type InboxEntry = Decoded<typeof inboxEntry>;
