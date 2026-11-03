import type { Execution, Inventory, Package, Publication, RepositoryRecord } from '@/automation/types';
import { type PackageIdentity, packageIdentity, purl } from '@/package-url';

type PackageRecord = Pick<Package, 'manager' | 'name' | 'version' | 'identity'>;
/** Legacy records acquire a typed identity at the boundary; adapters stay independent of purl types. */
export function identityOf(pkg: PackageRecord, repository?: string): PackageIdentity {
	if (pkg.identity) return packageIdentity(pkg.identity);
	if (pkg.manager === 'jsr') {
		const [namespace, name] = pkg.name.split('/');
		if (!namespace?.startsWith('@') || !name) throw new Error('Invalid JSR package name');
		return packageIdentity({
			type: 'generic',
			namespace,
			name,
			version: pkg.version,
			qualifiers: { repository_url: 'https://jsr.io' },
		});
	}
	const type = pkg.manager === 'go' && pkg.name.includes('/') ? 'golang' : ['npm', 'cargo'].includes(pkg.manager)
		? pkg.manager
		: (repository || pkg.name.includes('/')) && ['goreleaser', 'github-release'].includes(pkg.manager)
		? 'github'
		: 'generic';
	const version = type === 'github' && pkg.manager === 'goreleaser' && pkg.version
		? `v${pkg.version.replace(/^v/, '')}`
		: pkg.version;
	const qualified = type === 'github' ? repository ?? pkg.name : pkg.name;
	const slash = qualified.lastIndexOf('/');
	return packageIdentity({
		type,
		name: type === 'generic' ? qualified : slash < 0 ? qualified : qualified.slice(slash + 1),
		namespace: type === 'generic' ? pkg.manager : slash < 0 ? undefined : qualified.slice(0, slash),
		version,
	});
}
/** An adapter explicitly selects a new publication version; other identity components stay unchanged. */
export function publicationIdentity(pkg: PackageRecord, version: string): PackageIdentity {
	const identity = identityOf(pkg);
	return packageIdentity({
		...identity,
		version: identity.type === 'github' && pkg.manager === 'goreleaser'
			? `v${version.replace(/^v/, '')}`
			: version,
	});
}
export function packageId(pkg: PackageRecord): string {
	return packageKey(identityOf(pkg));
}
export function packageUrl(pkg: PackageRecord): string {
	return purl(identityOf(pkg));
}
/** Old repository configs and frozen releases can still select their original manager:name references. */
export function matchesPackage(reference: string, pkg: PackageRecord): boolean {
	if (!reference.startsWith('pkg:')) return reference === `${pkg.manager}:${pkg.name}`;
	const identity = packageIdentity(reference);
	return identity.version ? purl(identity) === packageUrl(pkg) : packageKey(identity) === packageId(pkg);
}
export function matchesPublication(reference: string, publication: Publication): boolean {
	return reference === publication.id
		|| ((publication.id.startsWith('pkg:') || publication.id === `${publication.manager}:${publication.name}`)
			&& matchesPackage(reference, publication));
}
export function identifyInventory(inventory: Inventory, repository?: string): Inventory {
	const packages = inventory.packages.map(pkg => ({ ...pkg, identity: identityOf(pkg, repository) }));
	return {
		...inventory,
		packages,
		publicationOrder: inventory.publicationOrder.map(reference => selectorKey(reference, packages)),
	};
}
export function identifyRepository(repository: RepositoryRecord): RepositoryRecord {
	return { ...repository, inventory: identifyInventory(repository.inventory, repository.name) };
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

export function selectorKey(reference: string, packages: Package[] = []): string {
	const found = packages.find(pkg => matchesPackage(reference, pkg));
	if (found) return packageId(found);
	if (reference.startsWith('pkg:')) return packageKey(reference);
	const colon = reference.indexOf(':');
	const manager = reference.slice(0, colon);
	if (['npm', 'jsr', 'cargo', 'go', 'github-release', 'goreleaser'].includes(manager)) {
		return packageId({ manager: manager as Package['manager'], name: reference.slice(colon + 1) });
	}
	return reference;
}

/** Versionless selection key; registry, platform and subpath distinctions remain significant. */
export function packageKey(input: PackageIdentity | string): string {
	const { version: _version, ...identity } = packageIdentity(input);
	return purl(identity);
}
