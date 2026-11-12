import { Schema } from 'effect';
import { onboardingBranch, updateBranch } from '@/automation/setup-changes';
import type { Decoded } from '@/schema';
import { matchesPattern, mutableStruct } from '@/schema';

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
			sha: Schema.String.check(matchesPattern(/^[a-f0-9]{40}$/)),
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
		merge_commit_sha: Schema.String.check(matchesPattern(/^[a-f0-9]{40}$/)),
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
	mutableStruct({ kind: Schema.Literal('release'), action: Schema.String }),
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
