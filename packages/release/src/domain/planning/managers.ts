import { Effect } from 'effect';
import type { ReleasePlan } from '@/automation/types';
import { applyVersionFiles } from '@/discovery/editing/version-files.ts';
import { discoveryRegistry } from '@/discovery/managers/builtins.ts';
import type { DiscoveryRegistry } from '@/discovery/managers/registry.ts';
import { isLockfile } from '@/domain/catalog.ts';
import type { Inventory, Package, Snapshot } from '@/domain/inventory.ts';
import { matchesPackage, packageId, publishablePackages } from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import type { VersionFile } from '@/domain/version-files.ts';
import { parseVersionRequest } from '@/domain/version-request.ts';
import { tagPrefix } from '@/domain/version-tags.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { alreadyPrepared, fileEdits } from '@/release/domain/planning/editors.ts';
import { resolvePackageVersion } from '@/release/domain/version.ts';

export { publicationOrder } from '@/domain/publication-order.ts';

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
	registry: DiscoveryRegistry = discoveryRegistry,
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

		const edits = yield* fileEdits(snapshot.files, changed);
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

export function placeholderVersion(version: string | undefined): boolean {
	return version === '0.0.0';
}
export function observedVersion(pkg: Package, tag: string, release?: string): string | undefined {
	const prefix = tagPrefix(pkg.versionSource);
	if (prefix === undefined) return placeholderVersion(pkg.version) && release !== undefined ? release : pkg.version;
	return tag.startsWith(prefix) ? tag.slice(prefix.length).replace(/^v/, '') : undefined;
}
