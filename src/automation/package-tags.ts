import { releaseIdentity } from '@/automation/package-identity';
import type { RefState } from '@/automation/refs';
import { parseTag } from '@/contract/version';
import type { PackageTagView } from '@/contract/views';

export interface PackageTagGroup {
	prefix: string;
	references: string[];
}
export interface Release {
	version: string;
	commit: string;
}
export type PackageTagState = 'exists' | 'conflict' | 'missing';
export interface PackageTagRow extends Release {
	tag: string;
	references: string[];
	state: PackageTagState;
	target?: string;
}
export type PackageTagResult = PackageTagView;

export function packageTagBase(reference: string): string {
	const { namespace, name } = releaseIdentity(reference);
	return [namespace?.replace(/^@/, ''), name].filter(part => part !== undefined && part !== '').join('-')
		.replaceAll('/', '-');
}

export function packageTagGroups(references: readonly string[], prefix: string): PackageTagGroup[] {
	const groups = new Map<string, string[]>();
	for (const reference of references) {
		const tagPrefix = `${packageTagBase(reference)}-${prefix}`;
		groups.set(tagPrefix, [...(groups.get(tagPrefix) ?? []), reference]);
	}
	return [...groups].map(([tagPrefix, grouped]) => ({ prefix: tagPrefix, references: grouped }));
}

export function taggedReleases(prefix: string, refs: readonly RefState[]): Release[] {
	return refs.flatMap(ref => {
		const version = parseTag({ prefix }, ref.name);
		return version === undefined ? [] : [{ version, commit: ref.commit }];
	});
}

export function packageTagRows(
	groups: readonly PackageTagGroup[],
	releases: readonly Release[],
	refs: readonly RefState[],
): PackageTagRow[] {
	return releases.flatMap(release =>
		groups.map(group => {
			const tag = `${group.prefix}${release.version}`;
			const existing = refs.find(ref => ref.name === tag);
			const state: PackageTagState = existing === undefined
				? 'missing'
				: existing.commit === release.commit
				? 'exists'
				: 'conflict';
			return {
				...release,
				tag,
				references: group.references,
				state,
				...(existing && state === 'conflict' ? { target: existing.commit } : {}),
			};
		})
	);
}
