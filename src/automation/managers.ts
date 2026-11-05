import { Effect } from 'effect';
import { alreadyPrepared, applyVersionFiles, type VersionFile } from '@/automation/editors';
import { managerRegistry } from '@/automation/managers/builtins';
import type { Fetcher, ManagerRegistry, VerificationContext } from '@/automation/managers/registry';
import { tagPrefix } from '@/automation/managers/tags';
import { matchesPackage, packageId } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { releasedVersion } from '@/automation/release-version';
import type { Inventory, Package, Publication, ReleasePlan, Snapshot } from '@/automation/types';
import { nextVersion, parseVersionRequest, type VersionRequest } from '@/automation/version';
import { isLockfile, type ManagerName } from '@/contract/catalog';
import { type DomainError, precondition } from '@/contract/errors';

export { publicationOrder } from '@/automation/managers/order';

function explicit(request: VersionRequest): Effect.Effect<string, DomainError> {
	return 'version' in request
		? Effect.succeed(request.version)
		: Effect.fail(precondition('Select an explicit version for the first release'));
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
): Effect.Effect<ReleasePlan, DomainError> {
	return Effect.gen(function*() {
		const request = yield* parseVersionRequest(target);
		if (selected?.some(name => !inventory.packages.some(p => publishable(p) && matchesPackage(name, p)))) {
			return yield* precondition('Unknown selected publishable package');
		}
		const packages = inventory.packages.filter(
			(p) => publishable(p) && (!selected || selected.some(reference => matchesPackage(reference, p))),
		);
		if (!packages.length) return yield* precondition('No selected publishable packages');
		if (new Set(packages.map(packageId)).size !== packages.length) {
			return yield* precondition('Duplicate selected package identity');
		}
		const current = [
			...new Set(packages.flatMap(p => {
				const version = releasedVersion(p);
				return version === undefined ? [] : [version];
			})),
		];
		if (!('version' in request) && packages.some(p => releasedVersion(p) === undefined)) {
			return yield* precondition('Select an explicit version for the first release');
		}
		if (!('version' in request) && current.length !== 1) {
			return yield* precondition('Select a synchronized version group or supply an explicit version');
		}
		const [first] = current;
		const version = first === undefined || 'version' in request
			? yield* explicit(request)
			: yield* nextVersion(first, request);
		const completing = packages.some(p => releasedVersion(p) !== version);
		for (const previous of current) {
			if (!completing || previous !== version) yield* nextVersion(previous, { version });
		}
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
export function observedVersion(pkg: Package, tag: string): string | undefined {
	const prefix = tagPrefix(pkg.versionSource);
	if (prefix === undefined) return pkg.version;
	return tag.startsWith(prefix) ? tag.slice(prefix.length).replace(/^v/, '') : undefined;
}
export function versionsInFiles(inventory: Inventory): boolean {
	return inventory.packages.some(p => publishable(p) && tagPrefix(p.versionSource) === undefined);
}
