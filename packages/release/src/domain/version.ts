import { Effect } from 'effect';
import { operations } from '@/domain/configuration/schema.ts';
import type { Inventory, Package } from '@/domain/inventory.ts';
import { matchesPackage } from '@/domain/package-identity.ts';
import { compareVersions } from '@/domain/semver.ts';
import type { VersionRequest } from '@/domain/version-request.ts';
import { nextVersion } from '@/domain/version-request.ts';
import { tagPrefix } from '@/domain/version-tags.ts';
import { distinct } from '@/kernel/collections/distinct.ts';
import { blocking } from '@/kernel/errors/diagnostics.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Stream } from '@/release/domain/execution/types.ts';

export function releasedVersion(pkg: Package): string | undefined {
	if (pkg.publicationStatus === 'published') return pkg.published;
	if (pkg.publicationStatus === 'missing') return undefined;
	return pkg.version;
}

function unique(values: (string | undefined)[]): string[] {
	return distinct(values.flatMap(value => value === undefined ? [] : [value]));
}

/** Resolve the shared release target from publication state, independently of file editing. */
export function resolvePackageVersion(
	packages: Package[],
	request: VersionRequest,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const current = unique(packages.map(releasedVersion));
		if (!('version' in request) && packages.some(pkg => releasedVersion(pkg) === undefined)) {
			return yield* precondition('Select an explicit version for the first release');
		}
		if (!('version' in request) && current.length !== 1) {
			return yield* precondition('Select a synchronized version group or supply an explicit version');
		}
		const [first] = current;
		const version = 'version' in request ? request.version : first === undefined
			? yield* precondition('Select an explicit version for the first release')
			: yield* nextVersion(first, request);
		const answered = packages.filter(pkg => pkg.publicationStatus !== 'failed');
		const completing = answered.length < packages.length || answered.some(pkg => releasedVersion(pkg) !== version);
		if (packages.every(pkg => pkg.publicationStatus === 'published' && pkg.published === version)) {
			return yield* precondition(`${version} is already released`);
		}
		for (const previous of unique(answered.map(releasedVersion))) {
			if (!completing || previous !== version) yield* nextVersion(previous, { version });
		}
		return version;
	});
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
	// Tags record releases already made; they cannot carry the version being
	// prepared in manifests. In a mixed stream those tags land during the release.
	const manifests = unique(packages.filter(pkg => tagPrefix(pkg.versionSource) === undefined).map(pkg => pkg.version));
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

export function releasePaths(packages: Package[], stream: Stream): ReadonlySet<string> {
	return new Set([
		...packages.filter(pkg => !stream.packages || stream.packages.some(reference => matchesPackage(reference, pkg)))
			.flatMap(pkg => [
				pkg.manifest,
				...(tagPrefix(pkg.versionSource) === undefined ? pkg.versionSource.split('#', 1) : []),
			]),
		...(stream.versionFiles ?? []).map(rule => rule.path),
		...[...operations(stream).values()].map(binding => `.github/workflows/${binding.file}`),
	]);
}

export function manifestProblems(inventory: Inventory, packages: Package[]): string[] {
	return blocking(inventory.diagnostics).flatMap(({ subject, message }) =>
		subject?.kind === 'file' && packages.some(pkg => pkg.manifest === subject.path) ? [message] : []
	);
}
