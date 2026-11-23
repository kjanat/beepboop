import { Schema } from 'effect';
import type { DiscoveredWorkflow, Inventory, Package, RepositoryRecord } from '@/domain/inventory.ts';
import { identityOf, selectorKey } from '@/domain/package-identity.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { blocking, legacyDiagnostic, messages } from '@/kernel/errors/diagnostics.ts';
import { stringsSchema as strings } from '@/kernel/schema/result.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import { storedConfiguration } from '@/persistence/codecs/configuration';
import type { StoredPackage } from '@/persistence/codecs/stored';
import { normalizePublication } from '@/persistence/codecs/stored';
import { channel, channelOutcome, managerName, shas, storedDiagnostic, storedPackage } from '@/persistence/codecs/v1';

export type StoredInventory = Omit<Inventory, 'packages' | 'diagnostics'> & {
	packages: StoredPackage[];
	diagnostics: string[];
	findings?: Diagnostic[];
};
export type StoredRepository = Omit<RepositoryRecord, 'inventory' | 'diagnostics' | 'access'> & {
	suspended?: boolean;
	inventory: StoredInventory;
	diagnostics: string[];
	findings?: Diagnostic[];
};
function findingsOf(stored: { diagnostics: string[]; findings?: Diagnostic[] }): Diagnostic[] {
	return stored.findings ?? stored.diagnostics.map(legacyDiagnostic);
}
function legacyInventoryFinding(message: string): Diagnostic {
	const path = /^([^\s:]+): /.exec(message)?.[1];
	return path === undefined
		? legacyDiagnostic(message)
		: { ...legacyDiagnostic(message), subject: { kind: 'file', path } };
}
export function identifyInventory(inventory: StoredInventory, repository?: string): Inventory {
	const packages = inventory.packages.map((stored): Package => {
		const pkg = normalizePublication(stored);
		return { ...pkg, identity: identityOf(pkg, repository) };
	});
	const { findings: _findings, ...rest } = inventory;
	return {
		...rest,
		packages,
		diagnostics: inventory.findings ?? inventory.diagnostics.map(legacyInventoryFinding),
		publicationOrder: inventory.publicationOrder.map(reference => selectorKey(reference, packages)),
	};
}
export function identifyRepository(repository: StoredRepository): RepositoryRecord {
	const { findings: _findings, suspended, ...rest } = repository;
	return {
		...rest,
		access: suspended ? { kind: 'suspended', since: repository.updatedAt } : { kind: 'active' },
		diagnostics: findingsOf(repository),
		inventory: identifyInventory(repository.inventory, repository.name),
	};
}
export function encodeInventory(inventory: Inventory): StoredInventory {
	return { ...inventory, diagnostics: messages(inventory.diagnostics), findings: inventory.diagnostics };
}
export function encodeRepository({ access, ...repository }: RepositoryRecord): StoredRepository {
	return {
		...repository,
		...(access.kind === 'suspended' ? { suspended: true } : {}),
		diagnostics: messages(blocking(repository.diagnostics)),
		findings: repository.diagnostics,
		inventory: encodeInventory(repository.inventory),
	};
}
const discoveredWorkflow: Schema.Codec<DiscoveredWorkflow, unknown> = mutableStruct({
	tagPatterns: Schema.optional(strings),
	branchPatterns: Schema.optional(strings),
	createsRelease: Schema.optional(Schema.Boolean),
	ledger: Schema.optional(Schema.Boolean),
	file: Schema.String,
	name: Schema.String,
	events: strings,
	jobs: strings,
	localActions: strings,
	dispatchInputs: strings,
	publication: Schema.Boolean,
});
const inventory: Schema.Codec<StoredInventory, unknown> = mutableStruct({
	references: Schema.optional(
		mutableArray(mutableStruct({ repository: Schema.String, path: Schema.String, ref: Schema.String })),
	),
	channels: Schema.optional(mutableArray(channel)),
	destinations: Schema.optional(mutableArray(channelOutcome)),
	packages: mutableArray(storedPackage),
	workflows: mutableArray(discoveredWorkflow),
	managers: mutableArray(managerName),
	diagnostics: strings,
	findings: Schema.optional(mutableArray(storedDiagnostic)),
	publicationOrder: strings,
});
const repositorySchema: Schema.Codec<StoredRepository, unknown> = mutableStruct({
	suspended: Schema.optional(Schema.Boolean),
	id: Schema.Finite,
	name: Schema.String,
	defaultBranch: Schema.String,
	sha: Schema.String,
	configuration: Schema.optional(storedConfiguration),
	presetShas: shas,
	inventory,
	diagnostics: strings,
	findings: Schema.optional(mutableArray(storedDiagnostic)),
	updatedAt: Schema.Finite,
});
export function decodeRepositoryV1(value: unknown): RepositoryRecord {
	return identifyRepository(decodeSync(repositorySchema, value));
}
