import { Schema } from 'effect';
import { bareSemverPattern } from '@/domain/semver.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mapped, matchesPattern, refined, safeDecode, strictStruct } from '@/kernel/schema/structs.ts';

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

export const tagPolicy = strictStruct({ prefix: refined(Schema.String, prefix => !prefix.includes('..')) });
export type TagPolicy = Decoded<typeof tagPolicy>;
export const defaultTagPolicy: TagPolicy = { prefix: 'v' };

export function tagFor(policy: TagPolicy, version: SemVer): string {
	return `${policy.prefix}${version}`;
}
export function parseTag(policy: TagPolicy, tag: string): SemVer | undefined {
	if (!tag.startsWith(policy.prefix)) return undefined;
	const parsed = safeDecode(semVer, tag.slice(policy.prefix.length));
	return parsed.success && tagFor(policy, parsed.data) === tag ? parsed.data : undefined;
}
