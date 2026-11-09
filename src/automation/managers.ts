import { Effect } from 'effect';
import { alreadyPrepared, applyVersionFiles } from '@/automation/editors';
import { managerRegistry } from '@/automation/managers/builtins';
import type { Fetcher, ManagerRegistry, VerificationContext } from '@/automation/managers/registry';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId, publishablePackages } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { resolvePackageVersion } from '@/automation/release-version';
import type { Inventory, Package, Publication, ReleasePlan, Snapshot } from '@/automation/types';
import { parseVersionRequest } from '@/automation/version';
import type { ManagerName } from '@/contract/catalog';
import { isLockfile } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import type { VersionFile } from '@/contract/version-files';

export { publicationOrder } from '@/automation/managers/order';

export function discover(snapshot: Snapshot, enabled: ManagerName[] = managerRegistry.names()): Inventory {
	return managerRegistry.discover(snapshot, enabled);
}

export function selectedReleasePackages(
	inventory: Inventory,
	selected?: string[],
): Effect.Effect<Package[], DomainError> {
	return Effect.gen(function*() {
		if (selected?.some(name => !inventory.packages.some(pkg => publishable(pkg) && matchesPackage(name, pkg)))) {
			return yield* precondition('Unknown selected publishable package');
		}
		const packages = publishablePackages(inventory.packages, selected);
		if (!packages.length) return yield* precondition('No selected publishable packages');
		if (new Set(packages.map(packageId)).size !== packages.length) {
			return yield* precondition('Duplicate selected package identity');
		}
		return packages;
	});
}

/** Changes only version-bearing lines. Lockfiles and generated files remain preparation-workflow work. */
export function planRelease(
	snapshot: Snapshot,
	inventory: Inventory,
	target: unknown,
	selected?: string[],
	registry: ManagerRegistry = managerRegistry,
	versionFiles: VersionFile[] = [],
): Effect.Effect<ReleasePlan, DomainError> {
	return Effect.gen(function*() {
		const request = yield* parseVersionRequest(target);
		const packages = yield* selectedReleasePackages(inventory, selected);
		const version = yield* resolvePackageVersion(packages, request);
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
			return yield* precondition('Selected packages share a version source with packages outside the selection');
		}
		for (const source of sources) {
			if (tagPrefix(source) !== undefined) continue;
			const path = source.split('#')[0];
			if (!path) return yield* precondition('Invalid version source');
			const before = changed.get(path) ?? snapshot.files[path];
			if (before === undefined) return yield* precondition('Missing manifest');
			changed.set(path, yield* registry.editVersion({ source, before, version, packages }));
		}
		yield* registry.updateDependencies({ snapshot, packages, version, changed });
		const files = { ...snapshot.files, ...Object.fromEntries(changed) };
		yield* applyVersionFiles(snapshot, files, versionFiles, { release: version });
		for (const [path, after] of Object.entries(files)) if (after !== snapshot.files[path]) changed.set(path, after);

		const edits: ReleasePlan['edits'] = [];
		for (const [path, after] of changed) {
			const before = snapshot.files[path];
			if (before === undefined) return yield* precondition('Missing planned manifest');
			if (before !== after) edits.push({ path, before, after });
		}
		const requiresPreparation = edits.length > 0
			&& Object.keys(snapshot.files).some(isLockfile);
		if (requiresPreparation) {
			diagnostics.push(
				'Preparation workflow must regenerate lockfiles and generated version carriers before promotion',
			);
		}
		if (!edits.length) diagnostics.push(alreadyPrepared(version, snapshot.sha));
		return {
			lockfiles: Object.keys(snapshot.files).filter(isLockfile),
			version,
			sourceSha: snapshot.sha,
			packages,
			edits,
			diagnostics,
			requiresPreparation,
		};
	});
}

export type { Fetcher, VerificationContext } from '@/automation/managers/registry';
export function canVerifyPublication(manager: ManagerName): boolean {
	return managerRegistry.canVerify(manager);
}
export function verifyPublication(
	publication: Publication,
	request: Fetcher = fetch,
	context?: VerificationContext,
): Effect.Effect<Publication> {
	return managerRegistry.verifyPublication(publication, request, context);
}
export function resolvePublished(
	inventory: Inventory,
	request: Fetcher = fetch,
	context?: VerificationContext,
): Effect.Effect<Inventory> {
	return managerRegistry.resolvePublished(inventory, request, context);
}
export function placeholderVersion(version: string | undefined): boolean {
	return version === '0.0.0';
}
export function observedVersion(pkg: Package, tag: string, release?: string): string | undefined {
	const prefix = tagPrefix(pkg.versionSource);
	if (prefix === undefined) return placeholderVersion(pkg.version) && release !== undefined ? release : pkg.version;
	return tag.startsWith(prefix) ? tag.slice(prefix.length).replace(/^v/, '') : undefined;
}
export function versionsInFiles(inventory: Inventory): boolean {
	return inventory.packages.some(p => publishable(p) && tagPrefix(p.versionSource) === undefined);
}
