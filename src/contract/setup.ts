import { z } from 'zod';
import { refPattern, tagPrefixPattern, validRef, validTagPrefix, workflowFilePattern } from '@/contract/catalog';

const workflow = z.object({
	file: z.string().regex(workflowFilePattern),
	job: z.string().optional(),
	triggers: z.enum(['review', 'dispatchOnly', 'preserve']).default('review'),
	/** Commands are explicit repository policy, never inferred from package names. */
	commands: z.string().default(''),
	/** Map publication identities to existing step IDs, for accurate outcome reporting. */
	publicationSteps: z.record(z.string(), z.string()).default({}),
}).strict();
const observed = z.object({
	name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
	file: z.string().regex(workflowFilePattern),
	ref: z.string().regex(refPattern).refine(validRef, 'Invalid workflow ref').optional(),
	publications: z.array(z.string()).default([]),
}).strict();
export const setupChoicesSchema = z.object({
	streams: z.array(
		z.object({
			name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
			packages: z.array(z.string()),
			versioning: z.enum(['workspace', 'independent', 'none']),
			required: z.array(z.string()),
			versionSource: z.object({
				kind: z.literal('tags'),
				prefix: z.string().regex(tagPrefixPattern).refine(validTagPrefix, 'Invalid tag prefix'),
			}).strict()
				.optional(),
			observe: z.array(observed).optional(),
			prepare: workflow.optional(),
			promote: workflow.optional(),
		}).strict(),
	),
	/** Full commit of the published Actions distribution, required for external actions. */
	actionsRevision: z.string().regex(/^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/).optional(),
}).strict();
export type SetupChoices = z.infer<typeof setupChoicesSchema>;
