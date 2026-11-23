import type { ResolvedInput } from '@/automation/execution-outputs';
import type { ExecutionStateView } from '@/contract/views';
import type { ManagerName } from '@/domain/catalog.ts';
import type { Configuration, WorkflowBinding } from '@/domain/configuration/schema.ts';
import type { GitHubRunState } from '@/domain/github-run-state.ts';
import type { Edit, Package } from '@/domain/inventory.ts';
import type { ModuleTag, RefPlan, RefState } from '@/domain/refs.ts';
import type { GateSkip } from '@/domain/release-gates.ts';
import type { StartChannel } from '@/domain/release-start.ts';
import type { AutoMergeMethod, VersionPrMerge } from '@/domain/setup-terms.ts';
import type { Publication } from '@/publication/publication.ts';
import type { PublishKind } from '@/publication/publish-pace.ts';
import type { FrozenPackageTag } from '@/release/domain/package-tags.ts';

export type { Configuration, Stream, Subscription, WorkflowBinding } from '@/domain/configuration/schema.ts';
export interface ReleasePlan {
	lockfiles?: string[];
	version: string;
	sourceSha: string;
	edits: Edit[];
	packages: Package[];
	diagnostics: string[];
	requiresPreparation: boolean;
}
export interface PackageTarget {
	id: string;
	manager: ManagerName;
}
export interface Artifact {
	id: number;
	runId: number;
	name: string;
	digest: string;
	expiresAt: string;
}
export type ExecutionState = ExecutionStateView;
export type RefNamespace = 'heads' | 'tags';
export interface ReleaseReference {
	group?: string;
	id: string;
	repository: { id: number; name: string };
	stream: string;
	commit: string;
	version: string;
	tag?: string;
	releaseId?: number;
	artifacts: Artifact[];
	publications: Publication[];
}
export interface AutomationEvent {
	occurredAt?: number;
	id: string;
	source: string;
	event: 'release' | 'workflow_run' | 'package.version.changed';
	version?: string;
	workflow?: string;
	release?: ReleaseReference;
}
export type SubscriptionDelivery = {
	id: string;
	eventId: string;
	repositoryId: number;
} & ({ execution: Execution } | { issue: { title: string; body: string } });
export type AutoMerge =
	| { method: AutoMergeMethod; state: 'enabled' }
	| { method: AutoMergeMethod; state: 'refused'; note: string };
export interface PreparationResult {
	url: string;
	head: string;
	kind?: 'commit';
	autoMerge?: AutoMerge;
}
export interface PreparedRelease extends PreparationResult {
	started?: ReleaseStarted;
}
export interface ReleaseStarted {
	via: StartChannel;
	actor: string;
	force?: true;
}
export interface Execution {
	prepared?: { edits: Edit[]; head?: string; result?: PreparationResult };
	releaseSet?: {
		preparationId: string;
		group: string;
		required: string[];
		workflowId?: string;
		operationCount?: number;
		workflowError?: string;
	};
	managed?: {
		kind: 'prepare';
		plan: ReleasePlan | import('@/automation/planning').ReleaseSetPlan;
		branch: string;
		title: string;
		body: string;
		head?: string;
		result?: PreparationResult;
	};
	resolvedInputs?: ResolvedInput[];
	refPlan?: RefPlan;
	reclaims?: RefState[];
	moduleTags?: ModuleTag[];
	packageTags?: FrozenPackageTag[];
	refNamespace?: RefNamespace;
	upstreamRelease?: ReleaseReference;
	release?: ReleaseReference;
	plan?: ReleasePlan | import('@/automation/planning').ReleaseSetPlan;
	id: string;
	repositoryId: number;
	repository: string;
	stream: string;
	operation: string;
	eventId: string;
	configuration: Configuration;
	configurationSha: string;
	presetShas: Record<string, string>;
	sourceSha: string;
	workflowSha?: string;
	helperShas?: string[];
	version?: string;
	state: ExecutionState;
	dependencies: string[];
	workflow?: WorkflowBinding & { ref: string };
	runId?: number;
	runAttempt?: number;
	github?: GitHubRunState;
	attempts: number;
	initiatedBy?: string;
	cancelledBy?: string;
	package?: PackageTarget;
	reservation?: PublishKind;
	notBefore?: number;
	supersededRuns?: number[];
	currentWorkflow?: boolean;
	draftRelease?: { id: number; tag: string };
	titled?: boolean;
	dispatchedAt?: number;
	approvedBy?: 'merge' | 'start';
	started?: ReleaseStarted;
	skippedGates?: GateSkip[];
	reruns?: { id: number; attempt: number }[];
	versionPrMerge?: VersionPrMerge;
	approvedAt?: number;
	publications: Publication[];
	artifacts: Artifact[];
	createdAt: number;
	updatedAt: number;
	reason?: string;
}

export interface ActivityEntry {
	id: string;
	actor: string;
	action: string;
	target: string;
	createdAt: number;
}
