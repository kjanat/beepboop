import type { Execution } from '@/automation/types';
import type { Package } from '@/domain/inventory.ts';
import { identityOf, packageId } from '@/domain/package-identity.ts';
import type { PackagePublication } from '@/domain/package-publication.ts';
import { excluded, registry } from '@/domain/package-publication.ts';

export type StoredPackage = Omit<Package, 'publication'> & { publication?: PackagePublication; publish?: boolean };
export function normalizePublication({ publish, publication, ...pkg }: StoredPackage): Package {
	return { ...pkg, publication: publication ?? (publish === false ? excluded('unrecorded') : registry) };
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
