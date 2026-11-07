import { Effect } from 'effect';
import { z } from 'zod';
import { exclusionReasons, type PackagePublication } from '@/automation/package-publication';
import type { SetupPlan, SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import { type DomainError, precondition } from '@/contract/errors';

const strings = z.array(z.string());
const workflow: z.ZodType<SetupWorkflow> = z.object({
	file: z.string(),
	job: z.string().optional(),
	triggers: z.enum(['review', 'dispatchOnly', 'preserve'], { error: 'Invalid workflow triggers' }),
	commands: z.string(),
	publicationSteps: z.record(z.string(), z.string()),
});
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
		streams: z.array(z.object({
			name: z.string(),
			packages: strings,
			versioning: z.enum(['workspace', 'independent', 'none'], { error: 'Invalid versioning' }),
			required: strings,
			versionSource: z.object({ kind: z.literal('tags'), prefix: z.string() }).optional(),
			observe: z.array(
				z.object({ name: z.string(), file: z.string(), ref: z.string().optional(), publications: strings }),
			).optional(),
			prepare: workflow.optional(),
			promote: workflow.optional(),
		})),
		actionsRevision: z.string().optional(),
	}),
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
	return parsed.success
		? Effect.succeed(parsed.data)
		: Effect.fail(precondition(parsed.error.issues[0]?.message ?? 'Invalid setup plan'));
}
