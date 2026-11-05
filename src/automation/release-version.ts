import { Effect } from 'effect';
import type { Inventory, Package } from '@/automation/types';
import { nextVersion, type VersionRequest } from '@/automation/version';
import { blocking } from '@/contract/diagnostics';
import { compareVersions } from '@/model';

export function releasedVersion(pkg: Package): string | undefined {
	if (pkg.publicationStatus === 'published') return pkg.published;
	if (pkg.publicationStatus === 'missing') return undefined;
	return pkg.version;
}

function unique(values: (string | undefined)[]): string[] {
	return [...new Set(values.flatMap(value => value === undefined ? [] : [value]))];
}

export function currentRelease(packages: Package[]): string | undefined {
	const released = unique(packages.map(releasedVersion));
	return released.length === 1 ? released[0] : undefined;
}

export function bumpedVersion(packages: Package[], request: VersionRequest): Effect.Effect<string | undefined> {
	const current = currentRelease(packages);
	return current === undefined
		? Effect.undefined
		: nextVersion(current, request).pipe(Effect.orElseSucceed(() => undefined));
}

export function recommendedVersion(packages: Package[]): Effect.Effect<string | undefined> {
	const manifests = unique(packages.map(pkg => pkg.version));
	const [manifest] = manifests;
	const released = unique(packages.map(releasedVersion));
	if (
		manifests.length === 1 && manifest !== undefined
		&& released.every(version => compareVersions(manifest, version) > 0)
	) {
		return Effect.succeed(manifest);
	}
	return bumpedVersion(packages, { bump: 'patch' });
}

export function unreleasedManifestVersion(packages: Package[]): string | undefined {
	const manifests = unique(packages.map(pkg => pkg.version));
	const [manifest] = manifests;
	if (manifests.length !== 1 || manifest === undefined || !packages.length) return undefined;
	if (packages.some(pkg => pkg.publicationStatus !== 'published' && pkg.publicationStatus !== 'missing')) {
		return undefined;
	}
	const released = packages.map(releasedVersion);
	if (released.some(version => version !== undefined && compareVersions(manifest, version) < 0)) return undefined;
	return released.some(version => version === undefined || compareVersions(manifest, version) > 0)
		? manifest
		: undefined;
}

export function manifestProblems(inventory: Inventory, packages: Package[]): string[] {
	return blocking(inventory.diagnostics).flatMap(({ subject, message }) =>
		subject?.kind === 'file' && packages.some(pkg => pkg.manifest === subject.path) ? [message] : []
	);
}
