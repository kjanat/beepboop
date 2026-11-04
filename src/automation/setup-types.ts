import { z } from 'zod';
import type { PackagePublication } from '@/automation/package-publication';

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
export type SetupWorkflow = NonNullable<SetupChoices['streams'][number]['prepare']>;
export type Versioning = SetupChoices['streams'][number]['versioning'];
export type TriggerHandover = SetupWorkflow['triggers'];
export const versionings: readonly Versioning[] = ['workspace', 'independent', 'none'];
export const triggerHandovers: readonly TriggerHandover[] = ['review', 'dispatchOnly', 'preserve'];
export type SetupOption =
	| { kind: 'package' | 'required'; stream: string; package: string }
	| { kind: 'workflow'; stream: string; operation: 'prepare' | 'promote'; file: string; job?: string }
	| { kind: 'versioning'; stream: string; value: Versioning }
	| { kind: 'triggers'; stream: string; operation: 'prepare' | 'promote'; value: TriggerHandover };
export interface SetupEdit {
	repositoryId: number;
	number: number;
	head: string;
	body: string;
	choices: SetupChoices;
	due: number;
}
export interface WorkflowEvidence {
	file: string;
	jobs: string[];
	steps: { job: string; id: string; label: string }[];
	events: string[];
	roles: { job: string; stream: string; operation: string }[];
	preparationJobs: string[];
	reportingJobs: string[];
	prepares: boolean;
	reports: boolean;
	publishes: boolean;
}
export interface SetupPlan {
	repository: string;
	sourceSha: string;
	planId: string;
	setupHead: string | null;
	choices: SetupChoices;
	inventory: { packages: { name: string; manifest: string; publication: PackagePublication }[] };
	packageIds: string[];
	workflows: WorkflowEvidence[];
	edits: { path: string; before: string; after: string }[];
	blockers: string[];
	notes: string[];
	branchConflict: boolean;
	prior?: { url: string; superseded: boolean };
}
