import type { PackagePublication } from '@/automation/package-publication';
import type { SetupChoices } from '@/contract/setup';

export type { SetupChoices } from '@/contract/setup';

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
