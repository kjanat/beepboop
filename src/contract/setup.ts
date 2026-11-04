import { z } from 'zod';

const workflow = z.object({
	file: z.string().regex(/^[A-Za-z0-9_-]+\.ya?ml$/),
	job: z.string().optional(),
	triggers: z.enum(['review', 'dispatchOnly', 'preserve']).default('review'),
	/** Commands are explicit repository policy, never inferred from package names. */
	commands: z.string().default(''),
	/** Map publication identities to existing step IDs, for accurate outcome reporting. */
	publicationSteps: z.record(z.string(), z.string()).default({}),
}).strict();
export const setupChoicesSchema = z.object({
	streams: z.array(
		z.object({
			name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
			packages: z.array(z.string()),
			versioning: z.enum(['workspace', 'independent', 'none']),
			required: z.array(z.string()),
			prepare: workflow.optional(),
			promote: workflow.optional(),
		}).strict(),
	),
	/** Full commit of the published Actions distribution, required for external actions. */
	actionsRevision: z.string().regex(/^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/).optional(),
}).strict();
export type SetupChoices = z.infer<typeof setupChoicesSchema>;
