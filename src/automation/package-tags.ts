import { matchesPackage } from '@/automation/package-identity';
import type { RefState } from '@/automation/refs';
import type { Package } from '@/automation/types';
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

export function packageTagBase(name: string): string {
	return name.replace(/^@/, '').replaceAll('/', '-');
}

export function packageTagGroups(
	references: readonly string[],
	prefix: string,
	packages: readonly Package[],
): PackageTagGroup[] {
	const groups = new Map<string, string[]>();
	for (const reference of references) {
		for (const pkg of packages.filter(candidate => matchesPackage(reference, candidate))) {
			const tagPrefix = `${packageTagBase(pkg.name)}-${prefix}`;
			const grouped = groups.get(tagPrefix) ?? [];
			if (!grouped.includes(reference)) grouped.push(reference);
			groups.set(tagPrefix, grouped);
		}
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
