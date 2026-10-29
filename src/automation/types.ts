import type { InputDeclaration, OutputDeclaration, Platform, ResolvedInput } from './outputs.ts';
import type { RefPlan, RefPolicy } from './refs.ts';
export type ManagerName =
	| 'pre-commit'
	| 'cargo'
	| 'npm'
	| 'github-release'
	| 'oci'
	| 'goreleaser'
	| 'manifest'
	| 'workflow';
export interface WorkflowBinding {
	platform?: Platform;
	outputs?: OutputDeclaration[];
	artifactInputs?: InputDeclaration[];
	refs?: RefPolicy;
	mode?: 'observe' | 'dispatch';
	needs?: string[];
	publications?: string[];
	schedule?: string;
	file: string;
	ref?: string;
	inputs?: Record<string, string | boolean | number>;
	required?: boolean;
}
export interface Stream {
	versionFiles?: import('./editors.ts').VersionFile[];
	versionSource?: { kind: 'tags'; prefix: string };
	packages?: string[];
	versioning: 'workspace' | 'independent' | 'none';
	prepare: { version: 'manual'; workflow?: WorkflowBinding; strategy?: 'managed' | 'workflow' };
	promote: { approval: 'required'; workflow?: WorkflowBinding };
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
	extends: string[];
	managers: ManagerName[];
	streams: Record<string, Stream>;
	subscriptions: Subscription[];
}
export interface Snapshot {
	repository: { id: number; name: string; defaultBranch: string };
	sha: string;
	files: Record<string, string>;
}
export interface Package {
	generated?: boolean;
	optional?: boolean;
	manager: ManagerName;
	name: string;
	version: string;
	manifest: string;
	versionSource: string;
	publish: boolean;
	dependencies: string[];
}
export interface DiscoveredWorkflow {
	tagTriggered?: boolean;
	file: string;
	name: string;
	events: string[];
	jobs: string[];
	localActions: string[];
	dispatchInputs: string[];
	publication: boolean;
}
export interface Inventory {
	references?: import('./precommit.ts').HookReference[];
	packages: Package[];
	workflows: DiscoveredWorkflow[];
	managers: ManagerName[];
	diagnostics: string[];
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
export interface Publication {
	id: string;
	manager: ManagerName;
	name: string;
	version: string;
	outcome: Outcome;
	digest?: string;
	url?: string;
	channel?: string;
	required: boolean;
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
	releaseSet?: { preparationId: string; group: string; required: string[] };
	managed?: {
		kind: 'prepare';
		plan: ReleasePlan | import('./planning.ts').ReleaseSetPlan;
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
	plan?: ReleasePlan | import('./planning.ts').ReleaseSetPlan;
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
	workflow?: WorkflowBinding;
	runId?: number;
	runAttempt?: number;
	attempts: number;
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
	diagnostics: string[];
	updatedAt: number;
}
