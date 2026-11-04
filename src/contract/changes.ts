import { z } from 'zod';

export const projectedEntities = ['execution', 'release-set', 'release'] as const;
export type ProjectedEntity = (typeof projectedEntities)[number];

export const change = z.object({
	seq: z.number().int().positive(),
	repositoryId: z.number().int().positive(),
	entity: z.enum(projectedEntities),
	id: z.string(),
	revision: z.number().int().positive(),
});
export type Change = z.output<typeof change>;

export const changesResponse = z.object({ cursor: z.number().int().nonnegative(), changes: z.array(change) });
export type ChangesResponse = z.output<typeof changesResponse>;
