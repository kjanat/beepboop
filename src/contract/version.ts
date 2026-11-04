import { z } from 'zod';
import { bareSemverPattern } from '@/contract/semver';

export { compare, isPrerelease, semverPattern } from '@/contract/semver';

export const semVer = z.string().transform(value => value.replace(/^v/, '')).pipe(z.string().regex(bareSemverPattern))
	.brand<'SemVer'>();
export type SemVer = z.output<typeof semVer>;

export const tagPolicy = z.strictObject({ prefix: z.string().refine(prefix => !prefix.includes('..')) });
export type TagPolicy = z.output<typeof tagPolicy>;
export const defaultTagPolicy: TagPolicy = { prefix: 'v' };

export function tagFor(policy: TagPolicy, version: SemVer): string {
	return `${policy.prefix}${version}`;
}
export function parseTag(policy: TagPolicy, tag: string): SemVer | undefined {
	if (!tag.startsWith(policy.prefix)) return undefined;
	const parsed = semVer.safeParse(tag.slice(policy.prefix.length));
	return parsed.success && tagFor(policy, parsed.data) === tag ? parsed.data : undefined;
}
