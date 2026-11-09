import { z } from 'zod';

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

export const executionView = z.looseObject({
	id: z.string(),
	repositoryId: z.number(),
	repository: z.string(),
	stream: z.string(),
	operation: z.string(),
	state: z.enum(executionStates),
	version: z.string().optional(),
	sourceSha: z.string(),
	updatedAt: z.number(),
});
export type ExecutionView = z.output<typeof executionView>;

export const repositoryView = z.looseObject({
	id: z.number(),
	name: z.string(),
	defaultBranch: z.string(),
	sha: z.string(),
	suspended: z.boolean().optional(),
	diagnostics: z.array(z.string()),
	configuration: z.looseObject({ streams: z.record(z.string(), z.unknown()) }).optional(),
});
export type RepositoryView = z.output<typeof repositoryView>;

export const binaryProgress = z.object({
	legs: z.array(z.object({
		build: z.string(),
		target: z.string(),
		job: z.string(),
		state: z.enum(['waiting', 'running', 'succeeded', 'failed', 'skipped']),
		startedAt: z.string().optional(),
		completedAt: z.string().optional(),
	})),
	assets: z.array(z.object({ build: z.string(), target: z.string(), name: z.string(), uploaded: z.boolean() })),
});
export type BinaryProgress = z.output<typeof binaryProgress>;

export const planReview = z.looseObject({
	sourceSha: z.string(),
	planId: z.string(),
	version: z.string().optional(),
	edits: z.array(z.object({ path: z.string(), before: z.string(), after: z.string() })),
	groups: z.array(z.looseObject({ id: z.string(), version: z.string(), packages: z.array(z.string()) })).optional(),
	diagnostics: z.array(z.string()).optional(),
	requiresPreparation: z.boolean(),
});
export type PlanReview = z.output<typeof planReview>;

export const credentialRow = z.looseObject({
	alias: z.string(),
	version: z.number(),
	key_id: z.string(),
	active: z.number(),
	created_at: z.number(),
});
export const credentialsView = z.looseObject({
	credentials: z.array(credentialRow),
	grants: z.array(z.looseObject({ id: z.string(), alias: z.string(), repositoryId: z.number(), delivery: z.string() })),
	deliveries: z.array(z.unknown()),
});
export type CredentialsView = z.output<typeof credentialsView>;

export const destinationView = z.looseObject({
	id: z.string(),
	name: z.string(),
	kind: z.string(),
	credential: z.string(),
	subscribeNew: z.boolean(),
	enabled: z.boolean(),
});
export const notificationsView = z.looseObject({
	destinations: z.array(destinationView),
	subscriptions: z.array(z.looseObject({ destinationId: z.string(), registry: z.string(), name: z.string() })),
	deliveries: z.array(z.unknown()),
});
export type NotificationsView = z.output<typeof notificationsView>;

export const approvalReadiness = z.looseObject({ problems: z.array(z.string()), blocked: z.array(z.string()) });
export const securityChallenge = z.looseObject({ id: z.string(), options: z.unknown() });
export const securityProof = z.looseObject({ proof: z.string().optional() });
export const acknowledged = z.looseObject({ ok: z.boolean() });
