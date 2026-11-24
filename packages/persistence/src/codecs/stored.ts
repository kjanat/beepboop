import type { Package } from '@/domain/inventory.ts';
import type { PackagePublication } from '@/domain/package-publication.ts';
import { excluded, registry } from '@/domain/package-publication.ts';

export type StoredPackage = Omit<Package, 'publication'> & { publication?: PackagePublication; publish?: boolean };
export function normalizePublication({ publish, publication, ...pkg }: StoredPackage): Package {
	return { ...pkg, publication: publication ?? (publish === false ? excluded('unrecorded') : registry) };
}
