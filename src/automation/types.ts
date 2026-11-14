import type { Channel, ChannelOutcome, RegistryOutcome } from '@/automation/destinations';
import type { ResolvedInput } from '@/automation/outputs';
import type { PackagePublication } from '@/automation/package-publication';
import type { ModuleTag, RefPlan } from '@/automation/refs';
import type { ManagerName } from '@/contract/catalog';
import type { Diagnostic } from '@/contract/diagnostics';
import type { StartChannel } from '@/contract/release-start';
import type { AutoMergeMethod } from '@/contract/setup-terms';
import type { ExecutionStateView } from '@/contract/views';
import type { Configuration, WorkflowBinding } from '@/domain/configuration';
import type { Access } from '@/domain/repository';
import type { PackageIdentity } from '@/package-url';

export type { Configuration, Stream, Subscription, WorkflowBinding } from '@/domain/configuration';
export interface Snapshot {
	repository: { id: number; name: string; defaultBranch: string };
	sha: string;
	files: Record<string, string>;
	paths: string[];
	links?: string[];
	tags?: string[];
}
export interface Package {
	/** Absent only on legacy records; normalized at discovery and persistence boundaries. */
	identity?: PackageIdentity;
	previousModule?: { name: string; version: string };
	publicationStatus?: 'published' | 'missing' | 'failed' | 'unchecked';
	destinations?: RegistryOutcome[];
	channels?: Channel[];
	generated?: boolean;
	optional?: boolean;
	manager: ManagerName;
	name: string;
	version?: string;
	published?: string;
	manifest: string;
	versionSource: string;
	publication: PackagePublication;
	dependencies: string[];
}
export interface DiscoveredWorkflow {
	tagPatterns?: string[];
	branchPatterns?: string[];
	createsRelease?: boolean;
	ledger?: boolean;
	file: string;
	name: string;
	events: string[];
	jobs: string[];
	localActions: string[];
	dispatchInputs: string[];
	publication: boolean;
}
export interface Inventory {
	references?: import('@/automation/precommit').HookReference[];
	channels?: Channel[];
	destinations?: ChannelOutcome[];
	packages: Package[];
	workflows: DiscoveredWorkflow[];
	managers: ManagerName[];
	diagnostics: Diagnostic[];
	publicationOrder: string[];
}
export interface Edit {
	path: string;
	before: string;
	after: string;
}
export interface ReleasePlan {
	lockfiles?: string[];
	version: string;
	sourceSha: string;
	edits: Edit[];
	packages: Package[];
	diagnostics: string[];
	requiresPreparation: boolean;
}
export type Outcome = 'pending' | 'succeeded' | 'failed' | 'uncertain' | 'skipped';
interface PublicationFields {
	identity?: PackageIdentity;
	id: string;
	manager: ManagerName;
	name: string;
	version: string;
	digest?: string;
	url?: string;
	channel?: string;
	required: boolean;
}
export type Publication =
	| (PublicationFields & { outcome: Outcome })
	| (PublicationFields & { outcome: 'rate-limited'; retryAfter: string });
export type PublishKind = 'new' | 'update';
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
export interface SubscriptionDelivery {
	id: string;
	eventId: string;
	repositoryId: number;
	execution: Execution;
}
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
	moduleTags?: ModuleTag[];
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
	attempts: number;
	initiatedBy?: string;
	package?: PackageTarget;
	reservation?: PublishKind;
	notBefore?: number;
	supersededRuns?: number[];
	draftRelease?: { id: number; tag: string };
	titled?: boolean;
	dispatchedAt?: number;
	approvedBy?: 'merge' | 'start';
	started?: ReleaseStarted;
	approvedAt?: number;
	publications: Publication[];
	artifacts: Artifact[];
	createdAt: number;
	updatedAt: number;
	reason?: string;
}
export interface RepositoryRecord {
	access: Access;
	id: number;
	name: string;
	defaultBranch: string;
	sha: string;
	configuration?: Configuration;
	presetShas: Record<string, string>;
	inventory: Inventory;
	diagnostics: Diagnostic[];
	updatedAt: number;
}

export interface ActivityEntry {
	id: string;
	actor: string;
	action: string;
	target: string;
	createdAt: number;
}
