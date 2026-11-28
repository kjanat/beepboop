import type { WorkflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import type { BinaryBuild, BinaryCandidate, BinaryTarget } from '@/domain/binary-platforms.ts';
import type { PackagePublication } from '@/domain/package-publication.ts';
import type { ConfigurableStart, VersionBump } from '@/domain/release-start.ts';
import type { VersionPrMerge } from '@/domain/setup-terms.ts';
import type { SetupChoices } from '@/setup/contract.ts';

export type { SetupChoices } from '@/setup/contract.ts';

export type SetupWorkflow = NonNullable<SetupChoices['streams'][number]['prepare']>;
export type SetupOperation = NonNullable<SetupChoices['streams'][number]['operations']>[number];
export type Versioning = SetupChoices['streams'][number]['versioning'];
export type Approval = NonNullable<SetupChoices['streams'][number]['approval']>;
export const approvals: readonly Approval[] = ['required', 'merge', 'push'];
export type TriggerHandover = SetupWorkflow['triggers'];
export const versionings: readonly Versioning[] = ['workspace', 'independent', 'none'];
export const triggerHandovers: readonly TriggerHandover[] = ['review', 'dispatchOnly', 'preserve'];
export type SetupOption =
	| { kind: 'package' | 'required'; stream: string; package: string }
	| { kind: 'workflow'; stream: string; operation: 'prepare' | 'release'; file: string; job?: string }
	| { kind: 'versioning'; stream: string; value: Versioning }
	| { kind: 'approval'; stream: string; value: Approval }
	| { kind: 'start'; stream: string; value: ConfigurableStart }
	| { kind: 'bump'; stream: string; value: VersionBump }
	| { kind: 'versionPrMerge'; stream: string; value: VersionPrMerge }
	| { kind: 'triggers'; stream: string; operation: 'prepare' | 'release'; value: TriggerHandover }
	| { kind: 'binary'; stream: string; build: BinaryBuild; targets: BinaryTarget[] }
	| { kind: 'target'; stream: string; target: BinaryTarget };
export interface SetupEdit {
	repositoryId: number;
	number: number;
	head: string;
	body: string;
	choices: SetupChoices;
	due: number;
}
export interface SetupPlan {
	actionRelease?: { manifests: string[]; files: string[]; missing: string[]; commands: string };
	publishingChecks?: PublishingCheck[];
	repository: string;
	sourceSha: string;
	planId: string;
	setupHead: string | null;
	choices: SetupChoices;
	inventory: {
		packages: {
			name: string;
			manifest: string;
			publication: PackagePublication;
			versionSource?: string;
			manager?: string;
		}[];
		publicationOrder?: string[];
	};
	preparation?: { lockfiles: string[]; versionFileStreams: string[]; workflowStreams: string[] };
	packageIds: string[];
	workflows: WorkflowEvidence[];
	edits: { path: string; before: string; after: string }[];
	blockers: string[];
	notes: string[];
	adoption?: string[];
	binaryCandidates?: BinaryCandidate[];
	branchConflict: boolean;
	prior?: { url: string; superseded: boolean };
}

export interface PublishingCheck {
	file: string;
	subject: string;
	status: 'passed' | 'action-required' | 'failed';
	message: string;
}
