import { excluded, type PackagePublication, registry } from '@/automation/package-publication';
import type { Execution, Inventory, Package, Publication, RepositoryRecord } from '@/automation/types';
import { type PackageIdentity, packageIdentity, purl } from '@/package-url';

type PackageRecord = Pick<Package, 'manager' | 'name' | 'version' | 'identity'>;
/** Legacy records acquire a typed identity at the boundary; adapters stay independent of purl types. */
export function identityOf(pkg: PackageRecord, repository?: string): PackageIdentity {
	if (pkg.identity) return releaseIdentity(pkg.identity);
	if (pkg.manager === 'jsr') {
		const [namespace, name] = pkg.name.split('/');
		if (!namespace?.startsWith('@') || !name) throw new Error('Invalid JSR package name');
		return packageIdentity({
			type: 'jsr',
			namespace,
			name,
			version: pkg.version,
		});
	}
	if (pkg.manager === 'vscode') {
		const { publisher, extension } = extensionParts(pkg.name);
		return packageIdentity({ type: 'vscode-extension', namespace: publisher, name: extension, version: pkg.version });
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
export function extensionParts(id: string): { publisher: string; extension: string } {
	const dot = id.indexOf('.');
	if (dot < 1 || dot === id.length - 1) throw new Error('Invalid VS Code extension ID');
	return { publisher: id.slice(0, dot), extension: id.slice(dot + 1) };
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
	const identity = releaseIdentity(reference);
	return identity.version ? purl(identity) === packageUrl(pkg) : packageKey(identity) === packageId(pkg);
}
export function matchesPublication(reference: string, publication: Publication): boolean {
	return reference === publication.id
		|| ((publication.id.startsWith('pkg:') || publication.id === `${publication.manager}:${publication.name}`)
			&& matchesPackage(reference, publication));
}
export type StoredPackage = Omit<Package, 'publication'> & { publication?: PackagePublication; publish?: boolean };
export type StoredInventory = Omit<Inventory, 'packages'> & { packages: StoredPackage[] };
export type StoredRepository = Omit<RepositoryRecord, 'inventory'> & { inventory: StoredInventory };
export function normalizePublication({ publish, publication, ...pkg }: StoredPackage): Package {
	return { ...pkg, publication: publication ?? (publish === false ? excluded('unrecorded') : registry) };
}
export function identifyInventory(inventory: StoredInventory, repository?: string): Inventory {
	const packages = inventory.packages.map((stored): Package => {
		const pkg = normalizePublication(stored);
		return { ...pkg, identity: identityOf(pkg, repository) };
	});
	return {
		...inventory,
		packages,
		publicationOrder: inventory.publicationOrder.map(reference => selectorKey(reference, packages)),
	};
}
export function identifyRepository(repository: StoredRepository): RepositoryRecord {
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
	const manager = (['npm', 'jsr', 'cargo', 'go', 'github-release', 'goreleaser', 'vscode'] as const).find(name =>
		name === reference.slice(0, colon)
	);
	if (manager) return packageId({ manager, name: reference.slice(colon + 1) });
	return reference;
}

/** Versionless selection key; registry, platform and subpath distinctions remain significant. */
export function packageKey(input: PackageIdentity | string): string {
	const { version: _version, ...identity } = releaseIdentity(input);
	return purl(identity);
}

/** Upgrade only Beepboop's historical JSR encoding; generic PURL parsing stays lossless. */
export function releaseIdentity(input: PackageIdentity | string): PackageIdentity {
	const identity = packageIdentity(input);
	if (
		identity.type !== 'generic' || !identity.namespace?.startsWith('@')
		|| !['https://jsr.io', 'https://jsr.io/'].includes(identity.qualifiers?.repository_url ?? '')
	) return identity;
	const { repository_url: _repository, ...qualifiers } = identity.qualifiers ?? {};
	return packageIdentity({ ...identity, type: 'jsr', qualifiers });
}
