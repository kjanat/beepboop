import type { ManagerName } from '@/domain/catalog.ts';
import type { Configuration } from '@/domain/configuration/schema.ts';
import type { Channel, ChannelOutcome, RegistryOutcome } from '@/domain/destinations.ts';
import type { PackagePublication } from '@/domain/package-publication.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import type { Access } from '@/domain/repository';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';

export interface HookReference {
	repository: string;
	path: string;
	ref: string;
}
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
	references?: HookReference[];
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
