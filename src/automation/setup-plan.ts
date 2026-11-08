import { Effect } from 'effect';
import { z } from 'zod';
import type { PackagePublication } from '@/automation/package-publication';
import { exclusionReasons } from '@/automation/package-publication';
import type { SetupOperation, SetupPlan, SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { binaries } from '@/contract/setup';
import { versionFileSchema } from '@/contract/version-files';

const strings = z.array(z.string());
const workflowShape = z.object({
	file: z.string(),
	job: z.string().optional(),
	triggers: z.enum(['review', 'dispatchOnly', 'preserve'], { error: 'Invalid workflow triggers' }),
	commands: z.string(),
	publicationSteps: z.record(z.string(), z.string()),
	credentials: z.record(z.string(), z.string()).optional(),
	tagPrefix: z.string().optional(),
	binaries: binaries.optional(),
});
const workflow: z.ZodType<SetupWorkflow> = workflowShape.strict();
const operation: z.ZodType<SetupOperation> = workflowShape.extend({
	name: z.string(),
	needs: strings,
	publications: strings,
}).strict();
const publication: z.ZodType<PackagePublication> = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('registry') }).transform((): PackagePublication => ({ kind: 'registry' })),
	z.object({ kind: z.literal('excluded'), reason: z.enum(exclusionReasons, { error: 'Invalid exclusion reason' }) })
		.transform(({ reason }): PackagePublication => ({ kind: 'excluded', reason })),
], { error: 'Invalid package publication' });
const evidence: z.ZodType<WorkflowEvidence> = z.object({
	file: z.string(),
	jobs: strings,
	steps: z.array(z.object({ job: z.string(), id: z.string(), label: z.string() })),
	events: strings,
	roles: z.array(z.object({ job: z.string(), stream: z.string(), operation: z.string() })),
	preparationJobs: strings,
	reportingJobs: strings,
	prepares: z.boolean(),
	reports: z.boolean(),
	publishes: z.boolean(),
});
const setupPlan: z.ZodType<SetupPlan> = z.object({
	repository: z.string(),
	sourceSha: z.string(),
	planId: z.string(),
	setupHead: z.string().nullable(),
	choices: z.object({
		streams: z.array(
			z.object({
				name: z.string(),
				packages: strings,
				versioning: z.enum(['workspace', 'independent', 'none'], { error: 'Invalid versioning' }),
				required: strings,
				versionSource: z.object({ kind: z.literal('tags'), prefix: z.string() }).optional(),
				versionFiles: z.array(versionFileSchema).optional(),
				observe: z.array(
					z.object({
						name: z.string(),
						file: z.string(),
						ref: z.string().optional(),
						publications: strings,
						needs: strings.optional(),
					}).strict(),
				).optional(),
				needs: z.record(z.string(), z.array(z.string())).optional(),
				prepare: workflow.optional(),
				promote: workflow.optional(),
				operations: z.array(operation).optional(),
			}).strict(),
		),
		actionsRevision: z.string().optional(),
	}).strict(),
	inventory: z.object({
		packages: z.array(
			z.object({
				name: z.string(),
				manifest: z.string(),
				publication,
				versionSource: z.string().optional(),
				manager: z.string().optional(),
			}),
		),
		publicationOrder: strings.optional(),
	}),
	preparation: z.object({ lockfiles: strings, versionFileStreams: strings, workflowStreams: strings }).optional(),
	packageIds: strings,
	workflows: z.array(evidence),
	edits: z.array(z.object({ path: z.string(), before: z.string(), after: z.string() })),
	blockers: strings,
	notes: strings,
	adoption: strings.optional(),
	branchConflict: z.unknown().transform(value => value === true),
	prior: z.object({ url: z.string(), superseded: z.boolean() }).optional(),
});

export function parseSetupPlan(value: unknown): Effect.Effect<SetupPlan, DomainError> {
	const parsed = setupPlan.safeParse(value);
	if (parsed.success) return Effect.succeed(parsed.data);
	const unknown =
		parsed.error.issues.flatMap(issue =>
			issue.code === 'unrecognized_keys' && issue.path[0] === 'choices' ? [issue] : []
		)[0];
	return Effect.fail(precondition(
		unknown
			? `The setup choices contain ${
				unknown.keys.join(', ')
			}, which this beepboop version does not support. Upgrade beepboop and run the command again.`
			: parsed.error.issues[0]?.message ?? 'Invalid setup plan',
	));
}
