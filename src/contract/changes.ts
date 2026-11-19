import { Schema } from 'effect';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

export const projectedEntities = ['execution', 'release-set', 'release'] as const;
export type ProjectedEntity = (typeof projectedEntities)[number];

export const change = mutableStruct({
	seq: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	entity: Schema.Literals(projectedEntities),
	id: Schema.String,
	revision: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
});
export type Change = Decoded<typeof change>;

export const changesResponse = mutableStruct({
	cursor: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
	changes: mutableArray(change),
});
export type ChangesResponse = Decoded<typeof changesResponse>;
