import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { looseStruct, mutableArray, mutableRecord, mutableStruct } from '@/schema';

export const tones = ['ok', 'active', 'waiting', 'warn', 'error', 'neutral'] as const;
export type Tone = (typeof tones)[number];

export interface Status {
	tone: Tone;
	label: string;
}

export const executionStates = [
	'pending',
	'awaiting-approval',
	'blocked',
	'ready',
	'dispatching',
	'running',
	'verifying',
	'succeeded',
	'failed',
	'cancelled',
	'uncertain',
] as const;
export type ExecutionStateView = (typeof executionStates)[number];

export const executionView = looseStruct({
	id: Schema.String,
	repositoryId: Schema.Finite,
	repository: Schema.String,
	stream: Schema.String,
	operation: Schema.String,
	state: Schema.Literals(executionStates),
	version: Schema.optional(Schema.String),
	sourceSha: Schema.String,
	updatedAt: Schema.Finite,
});
export type ExecutionView = Decoded<typeof executionView>;

export const releaseKinds = ['observes', 'unpublishable', 'promotes', 'prepares'] as const;
export const streamRelease = mutableStruct({ kind: Schema.Literals(releaseKinds), summary: Schema.String });
export type StreamRelease = Decoded<typeof streamRelease>;

export const repositoryView = looseStruct({
	id: Schema.Finite,
	name: Schema.String,
	defaultBranch: Schema.String,
	sha: Schema.String,
	suspended: Schema.optional(Schema.Boolean),
	diagnostics: mutableArray(Schema.String),
	configuration: Schema.optional(looseStruct({ streams: mutableRecord(Schema.String, Schema.Unknown) })),
	releases: mutableRecord(Schema.String, streamRelease),
});
export type RepositoryView = Decoded<typeof repositoryView>;

export const binaryProgress = mutableStruct({
	legs: mutableArray(mutableStruct({
		build: Schema.String,
		target: Schema.String,
		job: Schema.String,
		state: Schema.Literals(['waiting', 'running', 'succeeded', 'failed', 'skipped']),
		startedAt: Schema.optional(Schema.String),
		completedAt: Schema.optional(Schema.String),
	})),
	assets: mutableArray(
		mutableStruct({ build: Schema.String, target: Schema.String, name: Schema.String, uploaded: Schema.Boolean }),
	),
});
export type BinaryProgress = Decoded<typeof binaryProgress>;

export const planReview = looseStruct({
	sourceSha: Schema.String,
	planId: Schema.String,
	version: Schema.optional(Schema.String),
	edits: mutableArray(mutableStruct({ path: Schema.String, before: Schema.String, after: Schema.String })),
	groups: Schema.optional(
		mutableArray(looseStruct({ id: Schema.String, version: Schema.String, packages: mutableArray(Schema.String) })),
	),
	diagnostics: Schema.optional(mutableArray(Schema.String)),
	requiresPreparation: Schema.Boolean,
});
export type PlanReview = Decoded<typeof planReview>;

export const credentialRow = looseStruct({
	alias: Schema.String,
	version: Schema.Finite,
	key_id: Schema.String,
	active: Schema.Finite,
	created_at: Schema.Finite,
});
export const credentialsView = looseStruct({
	credentials: mutableArray(credentialRow),
	grants: mutableArray(
		looseStruct({ id: Schema.String, alias: Schema.String, repositoryId: Schema.Finite, delivery: Schema.String }),
	),
	deliveries: mutableArray(Schema.Unknown),
});
export type CredentialsView = Decoded<typeof credentialsView>;

export const destinationView = looseStruct({
	id: Schema.String,
	name: Schema.String,
	kind: Schema.String,
	credential: Schema.String,
	subscribeNew: Schema.Boolean,
	enabled: Schema.Boolean,
});
export const notificationsView = looseStruct({
	destinations: mutableArray(destinationView),
	subscriptions: mutableArray(
		looseStruct({ destinationId: Schema.String, registry: Schema.String, name: Schema.String }),
	),
	deliveries: mutableArray(Schema.Unknown),
});
export type NotificationsView = Decoded<typeof notificationsView>;

export const approvalReadiness = looseStruct({
	problems: mutableArray(Schema.String),
	blocked: mutableArray(Schema.String),
});
export const securityChallenge = looseStruct({ id: Schema.String, options: Schema.Unknown });
export const securityProof = looseStruct({ proof: Schema.optional(Schema.String) });
export const acknowledged = looseStruct({ ok: Schema.Boolean });
