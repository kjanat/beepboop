import type { Channel, ChannelOutcome, RegistryOutcome } from '@/automation/destinations';
import type { InputDeclaration, OutputDeclaration, Platform, ResolvedInput } from '@/automation/outputs';
import type { PackagePublication } from '@/automation/package-publication';
import type { RefPlan, RefPolicy } from '@/automation/refs';
import type { ManagerName } from '@/contract/catalog';
import type { Diagnostic } from '@/contract/diagnostics';
import type { PackageIdentity } from '@/package-url';
export interface WorkflowBinding {
	platform?: Platform;
	outputs?: OutputDeclaration[];
	artifactInputs?: InputDeclaration[];
	refs?: RefPolicy;
	mode?: 'observe' | 'dispatch';
	each?: 'package';
	needs?: string[];
	publications?: string[];
	schedule?: string;
	file: string;
	ref?: string;
	inputs?: Record<string, string | boolean | number>;
	required?: boolean;
}
export interface Stream {
	versionFiles?: import('@/automation/editors').VersionFile[];
	versionSource?: { kind: 'tags'; prefix: string };
	packages?: string[];
	versioning: 'workspace' | 'independent' | 'none';
	prepare: { version: 'manual'; workflow?: WorkflowBinding; strategy?: 'managed' | 'workflow' };
	promote: { approval: 'required' | 'merge' | 'push'; workflow?: WorkflowBinding };
	workflows: Record<string, WorkflowBinding>;
	required: string[];
	credentials: string[];
	channels: { stable: string; prerelease: string };
	concurrency: 'queue' | 'supersede-pending';
}
export interface Subscription {
	sourceStream?: string;
	sourceGroup?: string;
	publication?: string;
	workflow?: string;
	id: string;
	source: string;
	event: 'release' | 'package.version.changed' | 'workflow_run';
	stream: string;
	operation: string;
}
export interface Configuration {
	winget?: import('@/automation/winget').WinGetPolicy;
	extends: string[];
	managers: ManagerName[];
	streams: Record<string, Stream>;
	subscriptions: Subscription[];
}
export interface Snapshot {
	repository: { id: number; name: string; defaultBranch: string };
	sha: string;
	files: Record<string, string>;
	paths: string[];
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
export type ExecutionState =
	| 'pending'
	| 'blocked'
	| 'ready'
	| 'dispatching'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'uncertain';
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
export interface Execution {
	prepared?: { edits: Edit[]; head?: string; result?: { url: string; head: string } };
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
		result?: { url: string; head: string };
	};
	resolvedInputs?: ResolvedInput[];
	refPlan?: RefPlan;
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
	package?: PackageTarget;
	reservation?: PublishKind;
	notBefore?: number;
	supersededRuns?: number[];
	draftRelease?: { id: number; tag: string };
	titled?: boolean;
	dispatchedAt?: number;
	approvedBy?: 'merge';
	approvedAt?: number;
	publications: Publication[];
	artifacts: Artifact[];
	createdAt: number;
	updatedAt: number;
	reason?: string;
}
export interface RepositoryRecord {
	suspended?: boolean;
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
