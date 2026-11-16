import { Clock, Effect, Option } from 'effect';
import { matchesPackage } from '@/automation/package-identity';
import type { RefState } from '@/automation/refs';
import type { Package } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { parseTag } from '@/contract/version';
import type { PackageTagPage, PackageTagView } from '@/contract/views';

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
export const packageTagWindow = 10_000;
export const packageTagBudget = 20_000;
export const packageTagLate = 'The checks ran out of time; run beepboop tags backfill again';

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

export function packageTagPage<R>(
	rows: readonly PackageTagRow[],
	after: string | undefined,
	check: (row: PackageTagRow) => Effect.Effect<PackageTagResult, never, R>,
): Effect.Effect<PackageTagPage, DomainError, R> {
	return Effect.gen(function*() {
		const start = after === undefined ? 0 : rows.findIndex(row => row.tag === after) + 1;
		if (start === 0 && after !== undefined) {
			return yield* precondition(`${after} is missing from the package tags of this stream; run the backfill again`);
		}
		const pending = rows.slice(start);
		const clock = yield* Clock.Clock;
		const begin = clock.currentTimeMillisUnsafe();
		const checked = yield* Effect.forEach(pending, (row, index) => {
			const elapsed = clock.currentTimeMillisUnsafe() - begin;
			if (index > 0 && elapsed >= packageTagWindow) return Effect.undefined;
			const base = { tag: row.tag, version: row.version, commit: row.commit };
			return check(row).pipe(
				Effect.timeoutOption(packageTagBudget - elapsed),
				Effect.map(answer =>
					Option.getOrElse(answer, (): PackageTagResult => ({ ...base, outcome: 'failed', reason: packageTagLate }))
				),
			);
		}, { concurrency: 8 });
		const cut = checked.indexOf(undefined);
		const results = (cut < 0 ? checked : checked.slice(0, cut)).filter(result => result !== undefined);
		const last = results.at(-1);
		return cut < 0 || !last ? { results } : { results, next: last.tag };
	});
}

export function packageTagPages<R>(
	rows: readonly PackageTagRow[],
	check: (row: PackageTagRow) => Effect.Effect<PackageTagResult, never, R>,
): Effect.Effect<PackageTagResult[], DomainError, R> {
	return Effect.gen(function*() {
		const results: PackageTagResult[] = [];
		let after: string | undefined;
		do {
			const page = yield* packageTagPage(rows, after, check);
			results.push(...page.results);
			after = page.next;
		} while (after !== undefined);
		return results;
	});
}
