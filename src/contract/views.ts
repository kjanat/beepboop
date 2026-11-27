import { Schema } from 'effect';
import { githubJobKinds } from '@/domain/github-run-state.ts';
import { releaseGate } from '@/domain/release-gates.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

export const tones = ['ok', 'active', 'waiting', 'warn', 'error', 'neutral'] as const;
export type Tone = (typeof tones)[number];

export interface Status {
	tone: Tone;
	label: string;
	detail?: string;
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
	reason: Schema.optional(Schema.String),
	pendingApproval: Schema.optional(mutableStruct({ actor: Schema.String, sourceSha: Schema.String })),
});
export type ExecutionView = Decoded<typeof executionView>;

export const binaryProgress = mutableStruct({
	legs: mutableArray(mutableStruct({
		build: Schema.String,
		target: Schema.String,
		job: Schema.String,
		state: Schema.Literals(['waiting', 'running', 'succeeded', 'failed', 'skipped']),
		kind: Schema.optional(Schema.Literals(githubJobKinds)),
		status: Schema.optional(Schema.String),
		conclusion: Schema.optional(Schema.NullOr(Schema.String)),
		startedAt: Schema.optional(Schema.String),
		completedAt: Schema.optional(Schema.String),
	})),
	assets: mutableArray(
		mutableStruct({ build: Schema.String, target: Schema.String, name: Schema.String, uploaded: Schema.Boolean }),
	),
});
export type BinaryProgress = Decoded<typeof binaryProgress>;

export const packageTagOutcomes = ['exists', 'conflict', 'unpublished', 'publishable', 'created', 'failed'] as const;
export const packageTagView = mutableStruct({
	tag: Schema.String,
	version: Schema.String,
	commit: Schema.String,
	outcome: Schema.Literals(packageTagOutcomes),
	reason: Schema.optional(Schema.String),
});
export type PackageTagView = Decoded<typeof packageTagView>;
export const packageTagPage = mutableStruct({
	results: mutableArray(packageTagView),
	next: Schema.optional(Schema.String),
});
export type PackageTagPage = Decoded<typeof packageTagPage>;

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
	starts: Schema.Boolean,
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

export const approvalReadiness = looseStruct({
	problems: mutableArray(Schema.String),
	blocked: mutableArray(Schema.String),
});
export const gateStates = ['passed', 'waiting', 'failed', 'absent'] as const;
export const gateView = mutableStruct({
	gate: releaseGate,
	state: Schema.Literals(gateStates),
	fact: Schema.String,
	detail: Schema.optional(Schema.String),
	skipped: Schema.optional(mutableStruct({ actor: Schema.String, at: Schema.Finite })),
});
export type GateView = Decoded<typeof gateView>;
export const streamGates = mutableStruct({
	stream: Schema.String,
	commit: Schema.String,
	version: Schema.optional(Schema.String),
	gates: mutableArray(gateView),
});
export type StreamGates = Decoded<typeof streamGates>;
export const securityChallenge = looseStruct({ id: Schema.String, options: Schema.Unknown });
export const securityProof = looseStruct({ proof: Schema.optional(Schema.String) });
export const acknowledged = looseStruct({ ok: Schema.Boolean });
