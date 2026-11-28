import { Schema } from 'effect';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

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
