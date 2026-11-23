import { Schema } from 'effect';
import { decodeSync, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';

export interface WinGetPlan {
	id: string;
	repositoryId: number;
	repository: string;
	releaseId: number;
	tag: string;
	version: string;
	packageIdentifier: string;
	sourceSha: string;
	configurationSha: string;
	files: Record<string, string>;
	digest: string;
	releaseUrl: string;
}
export interface WinGetSubmission {
	plan: WinGetPlan;
	state: 'pending' | 'open' | 'merged' | 'closed' | 'failed';
	number?: number;
	url?: string;
	head?: string;
	checks?: string;
	reviews?: string;
	reason?: string;
	updatedAt: number;
}
export interface WinGetRelease {
	id: number;
	tag: string;
	name: string;
	publishedAt: number;
}
const submissionSchema: Schema.Codec<WinGetSubmission, unknown> = mutableStruct({
	plan: mutableStruct({
		id: Schema.String,
		repositoryId: Schema.Finite,
		repository: Schema.String,
		releaseId: Schema.Finite,
		tag: Schema.String,
		version: Schema.String,
		packageIdentifier: Schema.String,
		sourceSha: Schema.String,
		configurationSha: Schema.String,
		files: mutableRecord(Schema.String, Schema.String),
		releaseUrl: Schema.String,
		digest: Schema.String,
	}),
	state: Schema.Literals(['pending', 'open', 'merged', 'closed', 'failed']),
	number: Schema.optional(Schema.Finite),
	url: Schema.optional(Schema.String),
	head: Schema.optional(Schema.String),
	checks: Schema.optional(Schema.String),
	reviews: Schema.optional(Schema.String),
	reason: Schema.optional(Schema.String),
	updatedAt: Schema.Finite,
});
export function parseSubmission(document: string): WinGetSubmission {
	return decodeSync(submissionSchema, JSON.parse(document));
}
export function submissionBranch(plan: WinGetPlan): string {
	return `winget/${plan.packageIdentifier}/${plan.version}/${plan.digest.slice(0, 16)}`;
}
