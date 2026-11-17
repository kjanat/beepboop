import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { mutableStruct } from '@/schema';

export const githubJobKinds = [
	'waiting',
	'running',
	'succeeded',
	'failed',
	'cancelled',
	'skipped',
	'neutral',
	'timed-out',
	'action-required',
	'startup-failure',
	'stale',
	'unknown',
] as const;
export type GitHubJobKind = (typeof githubJobKinds)[number];

/** The provider's state is separate from Beepboop's publication lifecycle. */
export const githubRunState = mutableStruct({
	kind: Schema.Literals([...githubJobKinds, 'runner-unassigned']),
	status: Schema.NullOr(Schema.String),
	conclusion: Schema.NullOr(Schema.String),
	completed: Schema.Boolean,
});
export type GitHubRunState = Decoded<typeof githubRunState>;
