import { Effect } from 'effect';
import { type DomainError, precondition } from '@/contract/errors';
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
}
export interface RefPlan {
	repository: string;
	executionId: string;
	version: string;
	changes: RefChange[];
}
export function planRefs(
	policy: RefPolicy,
	version: string,
	commit: string,
	refs: RefState[],
): Effect.Effect<RefChange[], DomainError> {
	return Effect.gen(function*() {
		const normalized = yield* fromSync(() => semVer.parse(version));
		const tag = tagFor(policy, normalized);
		const full = refs.find(ref => ref.name === tag);
		if (full && full.commit !== commit) return yield* precondition('Version tag already targets another commit');
		if (policy.phase === 'version') {
			return [{ name: tag, expected: full?.oid ?? null, commit, annotated: true, signed: policy.signed }];
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
