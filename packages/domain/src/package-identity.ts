import { Result } from 'effect';
import { identifiedManagers, legacyJsrIdentity } from '@/domain/catalog.ts';
import type { Package } from '@/domain/inventory.ts';
import { publishable } from '@/domain/package-publication.ts';
import type { InvalidPackageUrl, PackageIdentity } from '@/domain/purl/index.ts';
import { invalidPackageUrl, packageIdentity, parsePackageIdentity, purl } from '@/domain/purl/index.ts';

export type PackageRecord = Pick<Package, 'manager' | 'name' | 'version' | 'identity'>;
/** Legacy records acquire a typed identity at the boundary; adapters stay independent of purl types. */
export function parseIdentity(
	pkg: PackageRecord,
	repository?: string,
): Result.Result<PackageIdentity, InvalidPackageUrl> {
	if (pkg.identity) return parseReleaseIdentity(pkg.identity);
	if (pkg.manager === 'jsr') {
		const [namespace, name] = pkg.name.split('/');
		if (!namespace?.startsWith('@') || !name) {
			return Result.fail(invalidPackageUrl('Invalid JSR package name'));
		}
		return parsePackageIdentity({ type: 'jsr', namespace, name, version: pkg.version });
	}
	if (pkg.manager === 'vscode') {
		return parseExtension(pkg.name).pipe(
			Result.flatMap(({ publisher, extension }) =>
				parsePackageIdentity({ type: 'vscode-extension', namespace: publisher, name: extension, version: pkg.version })
			),
		);
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
	return parsePackageIdentity({
		type,
		name: type === 'generic' ? qualified : slash < 0 ? qualified : qualified.slice(slash + 1),
		namespace: type === 'generic' ? pkg.manager : slash < 0 ? undefined : qualified.slice(0, slash),
		version,
	});
}
export function identityPackageName(identity: PackageIdentity): string {
	if (!identity.namespace) return identity.name;
	return identity.type === 'vscode-extension'
		? `${identity.namespace}.${identity.name}`
		: `${identity.namespace}/${identity.name}`;
}
export function identityOf(pkg: PackageRecord, repository?: string): PackageIdentity {
	return Result.getOrThrow(parseIdentity(pkg, repository));
}
export function parseExtension(id: string): Result.Result<{ publisher: string; extension: string }, InvalidPackageUrl> {
	const dot = id.indexOf('.');
	return dot < 1 || dot === id.length - 1
		? Result.fail(invalidPackageUrl('Invalid VS Code extension ID'))
		: Result.succeed({ publisher: id.slice(0, dot), extension: id.slice(dot + 1) });
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
const canonical = new Map<string, string>();
const canonicalLimit = 4096;
function remembered(key: string, compute: () => string): string {
	const known = canonical.get(key);
	if (known !== undefined) return known;
	const value = compute();
	if (canonical.size >= canonicalLimit) canonical.clear();
	canonical.set(key, value);
	return value;
}
function recordKey(pkg: PackageRecord): string {
	return JSON.stringify([pkg.identity ?? null, pkg.manager, pkg.name, pkg.version ?? null]);
}
export function packageId(pkg: PackageRecord): string {
	return remembered(`id ${recordKey(pkg)}`, () => packageKey(identityOf(pkg)));
}
export function packagePurl(pkg: PackageRecord): string {
	return remembered(`purl ${recordKey(pkg)}`, () => purl(identityOf(pkg)));
}
/** Old repository configs and frozen releases can still select their original manager:name references. */
export function matchesPackage(reference: string, pkg: PackageRecord): boolean {
	if (!reference.startsWith('pkg:')) return reference === `${pkg.manager}:${pkg.name}`;
	const selected = remembered(`reference ${reference}`, () => {
		const identity = releaseIdentity(reference);
		return identity.version ? `purl ${purl(identity)}` : `id ${packageKey(identity)}`;
	});
	return selected.startsWith('purl ')
		? selected.slice('purl '.length) === packagePurl(pkg)
		: selected.slice('id '.length) === packageId(pkg);
}
export function soleMatch<P extends PackageRecord>(reference: string, packages: readonly P[]): P | undefined {
	const matches = packages.filter(pkg => matchesPackage(reference, pkg));
	return matches.length === 1 ? matches[0] : undefined;
}
export function publishablePackages(packages: readonly Package[], references?: readonly string[]): Package[] {
	return packages.filter(pkg =>
		publishable(pkg) && (!references || references.some(reference => matchesPackage(reference, pkg)))
	);
}
export function matchesPublication(reference: string, publication: PackageRecord & { id: string }): boolean {
	return reference === publication.id
		|| ((publication.id.startsWith('pkg:') || publication.id === `${publication.manager}:${publication.name}`)
			&& matchesPackage(reference, publication));
}
export function selectorKey(reference: string, packages: Package[] = []): string {
	const found = packages.find(pkg => matchesPackage(reference, pkg));
	if (found) return packageId(found);
	if (reference.startsWith('pkg:')) return packageKey(reference);
	const colon = reference.indexOf(':');
	const manager = identifiedManagers.find(name => name === reference.slice(0, colon));
	if (manager) return packageId({ manager, name: reference.slice(colon + 1) });
	return reference;
}

/** Versionless selection key; registry, platform and subpath distinctions remain significant. */
export function packageKey(input: PackageIdentity | string): string {
	const compute = () => {
		const { version: _version, ...identity } = releaseIdentity(input);
		return purl(identity);
	};
	return typeof input === 'string' ? remembered(`key ${input}`, compute) : compute();
}

/** Upgrade only Beepboop's historical JSR encoding; generic PURL parsing stays lossless. */
export function parseReleaseIdentity(
	input: PackageIdentity | string,
): Result.Result<PackageIdentity, InvalidPackageUrl> {
	return parsePackageIdentity(input).pipe(Result.flatMap(identity => {
		if (!legacyJsrIdentity(identity)) return Result.succeed(identity);
		const { repository_url: _repository, ...qualifiers } = identity.qualifiers ?? {};
		return parsePackageIdentity({ ...identity, type: 'jsr', qualifiers });
	}));
}
export function releaseIdentity(input: PackageIdentity | string): PackageIdentity {
	return Result.getOrThrow(parseReleaseIdentity(input));
}
