import { Schema } from 'effect';
import { mutableArray, strictStruct } from '@/schema';

/** Server-owned publication work for the authenticated execution. */
export const workflowPublicationPlan = strictStruct({
	executionId: Schema.String,
	repositoryId: Schema.Finite,
	repository: Schema.String,
	sourceSha: Schema.String,
	packages: Schema.Boolean,
	refs: Schema.Boolean,
	release: Schema.Boolean,
	distribution: Schema.optional(strictStruct({ files: mutableArray(Schema.String) })),
});
export type WorkflowPublicationPlan = typeof workflowPublicationPlan.Type;
