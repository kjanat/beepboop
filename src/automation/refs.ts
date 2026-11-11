import { Effect } from 'effect';
import { matchesPackage } from '@/automation/package-identity';
import type { Package } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import type { SemVer } from '@/contract/version';
import { compare, isPrerelease, parseTag, semVer, tagFor } from '@/contract/version';
import { fromSync } from '@/failure';

export interface RefPolicy {
	phase: 'version' | 'aliases';
	prefix: string;
	aliases: ('major' | 'minor')[];
	signed: boolean;
}
export interface RefState {
	name: string;
	oid: string;
	commit: string;
}
export interface RefChange {
	name: string;
	expected: string | null;
	commit: string;
	annotated: boolean;
	signed: boolean;
	object?: string;
}
export interface RefPlan {
	repository: string;
	executionId: string;
	version: string;
	changes: RefChange[];
	publicKey?: string;
}
export interface SigningIdentity {
	publicKey: string;
	userId: string;
}
/** The `Signer` RPC entrypoint of gpg-signing-service. */
export interface TagSigner {
	identity(): Promise<SigningIdentity>;
	sign(data: string, caller: string): Promise<string>;
}
export function tagObject(change: RefChange, version: string, tagger: string, signature: string): string {
	return `${tagPayload(change, version, tagger)}${signature.endsWith('\n') ? signature : `${signature}\n`}`;
}
export function tagPayload(change: RefChange, version: string, tagger: string): string {
	return `object ${change.commit}\ntype commit\ntag ${change.name}\ntagger ${tagger}\n\nRelease ${version}\n`;
}
/** A Go module publishes a version by its own tag, such as `go/v1.2.3` for the module in `go/`. */
export function moduleTagPrefixes(packages: Package[], references: string[]): string[] {
	return packages.flatMap(pkg =>
		pkg.manager === 'go' && pkg.versionSource?.startsWith('tags:')
			&& references.some(reference => matchesPackage(reference, pkg))
			? [pkg.versionSource.slice('tags:'.length)]
			: []
	);
}
export function streamModuleTagPrefixes(
	packages: Package[],
	stream: { packages?: string[]; companionModules?: string[] } | undefined,
): string[] {
	return [
		...new Set(moduleTagPrefixes(packages, [...stream?.packages ?? [], ...stream?.companionModules ?? []])),
	];
}
function versionTags(policy: RefPolicy, version: SemVer, modulePrefixes: string[]): string[] {
	const tag = tagFor(policy, version);
	return policy.phase === 'version'
		? [tag, ...modulePrefixes.filter(prefix => prefix !== policy.prefix).map(prefix => `${prefix}${version}`)]
		: [tag];
}
export function tagConflict(
	policy: RefPolicy,
	version: SemVer,
	commit: string,
	refs: RefState[],
	modulePrefixes: string[] = [],
): RefState | undefined {
	for (const name of versionTags(policy, version, modulePrefixes)) {
		const existing = refs.find(ref => ref.name === name);
		if (existing && existing.commit !== commit) return existing;
	}
	return undefined;
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
): Effect.Effect<RefChange[], DomainError> {
	return Effect.gen(function*() {
		const normalized = yield* fromSync(() => semVer.parse(version));
		const conflict = tagConflict(policy, normalized, commit, refs, modulePrefixes);
		if (conflict) return yield* precondition(conflictMessage(conflict));
		const tag = tagFor(policy, normalized);
		const full = refs.find(ref => ref.name === tag);
		if (policy.phase === 'version') {
			return versionTags(policy, normalized, modulePrefixes).map(name => ({
				name,
				expected: refs.find(ref => ref.name === name)?.oid ?? null,
				commit,
				annotated: true,
				signed: policy.signed,
			}));
		}
		if (!full) return yield* precondition('Publish the version tag before aliases');
		if (isPrerelease(normalized)) return [];
		const [major, minor] = normalized.split('.');
		const changes: RefChange[] = [];
		for (const alias of policy.aliases) {
			const name = `${policy.prefix}${major}${alias === 'minor' ? `.${minor}` : ''}`;
			const inSeries = (candidate: string) => {
				const parts = candidate.split('.');
				return parts[0] === major && (alias === 'major' || parts[1] === minor);
			};
			const versions = refs.flatMap(ref => {
				const candidate = parseTag(policy, ref.name);
				return candidate && !isPrerelease(candidate) && inSeries(candidate) ? [{ ...ref, version: candidate }] : [];
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
