import { Schema } from 'effect';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';

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
