import { Effect, Schema } from 'effect';
import type { Package } from '@/domain/inventory.ts';
import { matchesPackage, packageId } from '@/domain/package-identity.ts';
import type { ModuleTag, RefChange, RefPolicy, RefState } from '@/domain/refs.ts';
import type { SemVer } from '@/domain/version.ts';
import { aliasSeries, compare, isPrerelease, parseTag, semVer, tagFor } from '@/domain/version.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

/** A Go module publishes a version by its own tag, such as `go/v1.2.3` for the module in `go/`. */
function moduleTags(packages: readonly Package[], references: string[]): ModuleTag[] {
	return packages.flatMap(pkg =>
		pkg.manager === 'go' && pkg.versionSource?.startsWith('tags:')
			&& references.some(reference => matchesPackage(reference, pkg))
			? [{ id: packageId(pkg), prefix: pkg.versionSource.slice('tags:'.length) }]
			: []
	);
}
export function moduleTagPrefixes(packages: readonly Package[], references: string[]): string[] {
	return moduleTags(packages, references).map(tag => tag.prefix);
}
export function streamModuleTags(
	packages: readonly Package[],
	stream: { packages?: string[]; companionModules?: string[] } | undefined,
): ModuleTag[] {
	return moduleTags(packages, [...stream?.packages ?? [], ...stream?.companionModules ?? []]);
}
export function tagPrefixes(tags: readonly ModuleTag[]): string[] {
	return [...new Set(tags.map(tag => tag.prefix))];
}
export function streamModuleTagPrefixes(
	packages: readonly Package[],
	stream: { packages?: string[]; companionModules?: string[] } | undefined,
): string[] {
	return tagPrefixes(streamModuleTags(packages, stream));
}
function versionTags(policy: RefPolicy, version: SemVer, modulePrefixes: string[]): string[] {
	const tag = tagFor(policy, version);
	return policy.phase === 'version'
		? [tag, ...modulePrefixes.filter(prefix => prefix !== policy.prefix).map(prefix => `${prefix}${version}`)]
		: [tag];
}
function reclaimed(tag: RefState, reclaims: readonly RefState[]): boolean {
	return reclaims.some(entry => entry.name === tag.name && entry.oid === tag.oid && entry.commit === tag.commit);
}
export function tagConflicts(
	policy: RefPolicy,
	version: SemVer,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
	reclaims: readonly RefState[] = [],
): RefState[] {
	return versionTags(policy, version, modulePrefixes).flatMap(name => {
		const existing = refs.find(ref => ref.name === name);
		return existing && existing.commit !== commit && !reclaimed(existing, reclaims) ? [existing] : [];
	});
}
export function tagConflict(
	policy: RefPolicy,
	version: SemVer,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
	reclaims: readonly RefState[] = [],
): RefState | undefined {
	return tagConflicts(policy, version, commit, refs, modulePrefixes, reclaims)[0];
}
export function versionTagged(
	policy: RefPolicy,
	version: SemVer,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
): boolean {
	return policy.phase === 'version'
		&& versionTags(policy, version, modulePrefixes).every(name =>
			refs.some(ref => ref.name === name && ref.commit === commit)
		);
}
export function conflictMessage(tag: RefState): string {
	return `Version tag ${tag.name} already targets ${tag.commit.slice(0, 12)}`;
}
export function planRefs(
	policy: RefPolicy,
	version: string,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
	reclaims: readonly RefState[] = [],
): Effect.Effect<RefChange[], DomainError> {
	return Effect.gen(function*() {
		const normalized = yield* fromSync(() => Schema.decodeSync(semVer)(version));
		const conflict = tagConflict(policy, normalized, commit, refs, modulePrefixes, reclaims);
		if (conflict) return yield* precondition(conflictMessage(conflict));
		const tag = tagFor(policy, normalized);
		const full = refs.find(ref => ref.name === tag);
		if (policy.phase === 'version') {
			return versionTags(policy, normalized, modulePrefixes).map(name => {
				const existing = refs.find(ref => ref.name === name);
				return {
					name,
					expected: existing?.oid ?? null,
					commit,
					annotated: true,
					signed: policy.signed,
					...(existing && existing.commit !== commit ? { replaces: true } : {}),
				};
			});
		}
		if (!full) return yield* precondition('Publish the version tag before aliases');
		if (isPrerelease(normalized)) return [];
		const changes: RefChange[] = [];
		for (const alias of policy.aliases) {
			const series = aliasSeries(normalized, alias);
			const name = policy.prefix + series;
			const versions = refs.flatMap(ref => {
				const candidate = parseTag(policy, ref.name);
				return candidate && !isPrerelease(candidate) && aliasSeries(candidate, alias) === series
					? [{ ...ref, version: candidate }]
					: [];
			});
			if (versions.some(ref => compare(ref.version, normalized) > 0)) {
				return yield* precondition('Alias update would downgrade its release series');
			}
			const old = refs.find(ref => ref.name === name);
			if (old && !versions.some(ref => ref.commit === old.commit)) {
				return yield* precondition('Alias target is outside its release series');
			}
			changes.push({ name, expected: old?.oid ?? null, commit, annotated: false, signed: false });
		}
		return changes;
	});
}
export function refsLanded(
	policy: RefPolicy,
	version: string,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
): Effect.Effect<boolean> {
	return planRefs(policy, version, commit, refs, modulePrefixes).pipe(Effect.match({
		onFailure: () => false,
		onSuccess: changes =>
			changes.every(change =>
				refs.some(ref =>
					ref.name === change.name && ref.commit === change.commit && (!change.annotated || ref.oid !== ref.commit)
				)
			),
	}));
}
export function releaseCommit(execution: Execution): string {
	return execution.refPlan?.distribution?.commit ?? execution.refPlan?.changes[0]?.commit ?? execution.sourceSha;
}
