import { compareVersions, semver } from '#model';

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
export function planRefs(policy: RefPolicy, version: string, commit: string, refs: RefState[]): RefChange[] {
	const normalized = semver(version).replace(/^v/, '');
	const tag = `${policy.prefix}${normalized}`;
	const full = refs.find(ref => ref.name === tag);
	if (full && full.commit !== commit) throw new Error('Version tag already targets another commit');
	if (policy.phase === 'version') {
		return [{ name: tag, expected: full?.oid ?? null, commit, annotated: true, signed: policy.signed }];
	}
	if (!full) throw new Error('Publish the version tag before aliases');
	if (normalized.split('+')[0]?.includes('-')) return [];
	const [major, minor] = normalized.split('.');
	return policy.aliases.flatMap(alias => {
		const name = `${policy.prefix}${major}${alias === 'minor' ? `.${minor}` : ''}`;
		const inSeries = (candidate: string) => {
			const parts = candidate.split('.');
			return parts[0] === major && (alias === 'major' || parts[1] === minor);
		};
		const versions = refs.flatMap(ref => {
			if (!ref.name.startsWith(policy.prefix)) return [];
			const candidate = ref.name.slice(policy.prefix.length);
			try {
				semver(candidate);
			} catch {
				return [];
			}
			return !candidate.split('+')[0]?.includes('-') && inSeries(candidate) ? [{ ...ref, version: candidate }] : [];
		});
		if (versions.some(ref => compareVersions(ref.version, normalized) > 0)) {
			throw new Error('Alias update would downgrade its release series');
		}
		const old = refs.find(ref => ref.name === name);
		if (old && !versions.some(ref => ref.commit === old.commit)) {
			throw new Error('Alias target is outside its release series');
		}
		return [{ name, expected: old?.oid ?? null, commit, annotated: false, signed: false }];
	});
}
