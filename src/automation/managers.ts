import { alreadyPrepared, applyVersionFiles, type VersionFile } from '@/automation/editors';
import { managerRegistry } from '@/automation/managers/builtins';
import type { Fetcher, ManagerRegistry, VerificationContext } from '@/automation/managers/registry';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { releasedVersion } from '@/automation/release-version';
import type { Inventory, Package, Publication, ReleasePlan, Snapshot } from '@/automation/types';
import { nextVersion, parseVersionRequest, type VersionRequest } from '@/automation/version';
import type { ManagerName } from '@/contract/catalog';

export { publicationOrder } from '@/automation/managers/order';

function explicit(request: VersionRequest): string {
	if (!('version' in request)) throw new Error('Select an explicit version for the first release');
	return request.version;
}
export function discover(snapshot: Snapshot, enabled: ManagerName[] = managerRegistry.names()): Inventory {
	return managerRegistry.discover(snapshot, enabled);
}

/** Changes only version-bearing lines. Lockfiles and generated files remain preparation-workflow work. */
export function planRelease(
	snapshot: Snapshot,
	inventory: Inventory,
	target: unknown,
	selected?: string[],
	registry: ManagerRegistry = managerRegistry,
	versionFiles: VersionFile[] = [],
): ReleasePlan {
	const request = parseVersionRequest(target);
	if (selected?.some(name => !inventory.packages.some(p => publishable(p) && matchesPackage(name, p)))) {
		throw new Error('Unknown selected publishable package');
	}
	const packages = inventory.packages.filter(
		(p) => publishable(p) && (!selected || selected.some(reference => matchesPackage(reference, p))),
	);
	if (!packages.length) throw new Error('No selected publishable packages');
	if (new Set(packages.map(packageId)).size !== packages.length) {
		throw new Error('Duplicate selected package identity');
	}
	const current = [
		...new Set(packages.flatMap(p => {
			const version = releasedVersion(p);
			return version === undefined ? [] : [version];
		})),
	];
	if (!('version' in request) && packages.some(p => releasedVersion(p) === undefined)) {
		throw new Error('Select an explicit version for the first release');
	}
	if (!('version' in request) && current.length !== 1) {
		throw new Error('Select a synchronized version group or supply an explicit version');
	}
	const [first] = current;
	const version = first === undefined || 'version' in request ? explicit(request) : nextVersion(first, request);
	const completing = packages.some(p => releasedVersion(p) !== version);
	for (const previous of current) if (!completing || previous !== version) nextVersion(previous, { version });
	const diagnostics: string[] = [],
		changed = new Map<string, string>();
	const sources = new Set(packages.map((p) => p.versionSource));
	if (
		selected
		&& inventory.packages.some(
			(p) =>
				publishable(p)
				&& sources.has(p.versionSource)
				&& !packages.some((chosen) => chosen.manager === p.manager && chosen.name === p.name),
		)
	) {
		throw new Error('Selected packages share a version source with packages outside the selection');
	}
	for (const source of sources) {
		if (tagPrefix(source) !== undefined) continue;
		const path = source.split('#')[0];
		if (!path) throw new Error('Invalid version source');
		const before = changed.get(path) ?? snapshot.files[path];
		if (before === undefined) throw new Error('Missing manifest');
		changed.set(path, registry.editVersion({ source, before, version, packages }));
	}
	registry.updateDependencies({ snapshot, packages, version, changed });
	const files = { ...snapshot.files, ...Object.fromEntries(changed) };
	applyVersionFiles(snapshot, files, versionFiles, { release: version });
	for (const [path, after] of Object.entries(files)) if (after !== snapshot.files[path]) changed.set(path, after);

	const edits = [...changed]
		.map(([path, after]) => {
			const before = snapshot.files[path];
			if (before === undefined) throw new Error('Missing planned manifest');
			return { path, before, after };
		})
		.filter((e) => e.before !== e.after);
	const requiresPreparation = edits.length > 0
		&& Object.keys(snapshot.files).some((p) =>
			/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(p)
		);
	if (requiresPreparation) {
		diagnostics.push(
			'Preparation workflow must regenerate lockfiles and generated version carriers before promotion',
		);
	}
	if (!edits.length) diagnostics.push(alreadyPrepared(version, snapshot.sha));
	return {
		lockfiles: Object.keys(snapshot.files).filter(path =>
			/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
		),
		version,
		sourceSha: snapshot.sha,
		packages,
		edits,
		diagnostics,
		requiresPreparation,
	};
}

export type { Fetcher, VerificationContext } from '@/automation/managers/registry';
export function canVerifyPublication(manager: ManagerName): boolean {
	return managerRegistry.canVerify(manager);
}
export async function verifyPublication(
	publication: Publication,
	request: Fetcher = fetch,
	context?: VerificationContext,
): Promise<Publication> {
	return managerRegistry.verifyPublication(publication, request, context);
}
export async function resolvePublished(
	inventory: Inventory,
	request: Fetcher = fetch,
	context?: VerificationContext,
): Promise<Inventory> {
	return managerRegistry.resolvePublished(inventory, request, context);
}
export function observedVersion(pkg: Package, tag: string): string | undefined {
	const prefix = tagPrefix(pkg.versionSource);
	if (prefix === undefined) return pkg.version;
	return tag.startsWith(prefix) ? tag.slice(prefix.length).replace(/^v/, '') : undefined;
}
export function versionsInFiles(inventory: Inventory): boolean {
	return inventory.packages.some(p => publishable(p) && tagPrefix(p.versionSource) === undefined);
}
