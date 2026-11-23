import type { Execution } from '@/automation/types';
import type { Inventory, Package, RepositoryRecord } from '@/domain/inventory.ts';
import { identityOf, packageId, selectorKey } from '@/domain/package-identity.ts';
import type { PackagePublication } from '@/domain/package-publication.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { blocking, legacyDiagnostic, messages } from '@/kernel/errors/diagnostics.ts';

export type StoredPackage = Omit<Package, 'publication'> & { publication?: PackagePublication; publish?: boolean };
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
export function normalizePublication({ publish, publication, ...pkg }: StoredPackage): Package {
	return { ...pkg, publication: publication ?? (publish === false ? excluded('unrecorded') : registry) };
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
export function identifyExecution(execution: Execution): Execution {
	return {
		...execution,
		publications: execution.publications.map(publication => {
			const identified = { ...publication, identity: identityOf(publication, execution.repository) };
			return {
				...identified,
				id: publication.id === `${publication.manager}:${publication.name}` || publication.id.startsWith('pkg:')
					? packageId(identified)
					: publication.id,
			};
		}),
	};
}
