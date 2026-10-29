import { applyVersionFiles, type VersionFile } from './editors.ts';
import { managerRegistry } from './managers/builtins.ts';
import type { Fetcher, ManagerRegistry } from './managers/registry.ts';
import type { Inventory, ManagerName, Publication, ReleasePlan, Snapshot } from './types.ts';
import { nextVersion, parseVersionRequest } from './version.ts';

export { publicationOrder } from './managers/order.ts';
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
	if (selected?.some(name => !inventory.packages.some(p => p.publish && `${p.manager}:${p.name}` === name))) {
		throw new Error('Unknown selected publishable package');
	}
	const packages = inventory.packages.filter(
		(p) => p.publish && (!selected || selected.includes(`${p.manager}:${p.name}`)),
	);
	if (!packages.length) throw new Error('No selected publishable packages');
	if (new Set(packages.map(p => `${p.manager}:${p.name}`)).size !== packages.length) {
		throw new Error('Duplicate selected package identity');
	}
	const current = [...new Set(packages.map(p => p.version))];
	if (!('version' in request) && current.length !== 1) {
		throw new Error('Select a synchronized version group or supply an explicit version');
	}
	const version = nextVersion(current[0] as string, request);
	for (const previous of current) nextVersion(previous, { version });
	const diagnostics: string[] = [],
		changed = new Map<string, string>();
	const sources = new Set(packages.map((p) => p.versionSource));
	if (
		selected
		&& inventory.packages.some(
			(p) =>
				p.publish
				&& sources.has(p.versionSource)
				&& !packages.some((chosen) => chosen.manager === p.manager && chosen.name === p.name),
		)
	) {
		throw new Error('Selected packages share a version source with packages outside the selection');
	}
	for (const source of sources) {
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

	const requiresPreparation = Object.keys(snapshot.files).some((p) =>
		/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(p)
	);
	if (requiresPreparation) {
		diagnostics.push(
			'Preparation workflow must regenerate lockfiles and generated version carriers before promotion',
		);
	}
	return {
		lockfiles: Object.keys(snapshot.files).filter(path =>
			/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
		),
		version,
		sourceSha: snapshot.sha,
		packages,
		edits: [...changed]
			.map(([path, after]) => ({ path, before: snapshot.files[path] as string, after }))
			.filter((e) => e.before !== e.after),
		diagnostics,
		requiresPreparation,
	};
}

export type { Fetcher } from './managers/registry.ts';
export function canVerifyPublication(manager: ManagerName): boolean {
	return managerRegistry.canVerify(manager);
}
export async function verifyPublication(publication: Publication, request: Fetcher = fetch): Promise<Publication> {
	return managerRegistry.verifyPublication(publication, request);
}
