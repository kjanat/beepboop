import { Schema } from 'effect';
import type { RefPolicy } from '@/domain/refs.ts';
import { bareSemverPattern } from '@/domain/semver.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mapped, matchesPattern, safeDecode } from '@/kernel/schema/structs.ts';

export { aliasSeries, compare, isPrerelease, semverPattern } from '@/domain/semver.ts';

export const semVer = mapped(
	Schema.String,
	Schema.String.check(matchesPattern(bareSemverPattern)),
	value => value.replace(/^v/, ''),
	value => value,
).pipe(
	Schema.brand('SemVer'),
);
export type SemVer = Decoded<typeof semVer>;

export type TagPolicy = Pick<RefPolicy, 'prefix'>;
export const defaultTagPolicy: TagPolicy = { prefix: 'v' };

export function tagFor(policy: TagPolicy, version: SemVer): string {
	return `${policy.prefix}${version}`;
}
export function parseTag(policy: TagPolicy, tag: string): SemVer | undefined {
	if (!tag.startsWith(policy.prefix)) return undefined;
	const parsed = safeDecode(semVer, tag.slice(policy.prefix.length));
	return parsed.success && tagFor(policy, parsed.data) === tag ? parsed.data : undefined;
}
