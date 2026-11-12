import { Schema } from 'effect';
import { bareSemverPattern } from '@/contract/semver';
import type { Decoded } from '@/schema';
import { mapped, matchesPattern, refined, safeDecode, strictStruct } from '@/schema';

export { compare, isPrerelease, semverPattern } from '@/contract/semver';

export const semVer = mapped(Schema.String, value => value.replace(/^v/, '')).pipe(
	Schema.decodeTo(Schema.String.check(matchesPattern(bareSemverPattern))),
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
