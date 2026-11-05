import { Result } from 'effect';
import { directory } from '@/automation/managers/helpers';
import { goreleaserConfig } from '@/contract/catalog';
import { compareVersions, semver } from '@/model';

export const majorSuffix = /^v(?:[2-9]|[1-9][0-9]+)$/;

export function tagSource(prefix: string): string {
	return `tags:${prefix}`;
}
export function tagPrefix(source: string): string | undefined {
	return source.startsWith('tags:') ? source.slice('tags:'.length) : undefined;
}
export function latestTag(
	tags: readonly string[],
	prefix: string,
	accept: (version: string) => boolean = () => true,
): string | undefined {
	return tags.flatMap(tag => {
		if (!tag.startsWith(prefix)) return [];
		const version = tag.slice(prefix.length);
		if (Result.isFailure(Result.try(() => semver(version)))) return [];
		return accept(version) ? [version.replace(/^v/, '')] : [];
	}).sort(compareVersions).at(-1);
}
export function tagQueries(paths: readonly string[]): string[] {
	const prefixes = new Set<string>();
	for (const path of paths) {
		if (goreleaserConfig.test(path)) prefixes.add('');
		if (path !== 'go.mod' && !path.endsWith('/go.mod')) continue;
		const dir = directory(path);
		prefixes.add(dir ? `${dir}/` : '');
		if (majorSuffix.test(dir.slice(dir.lastIndexOf('/') + 1))) {
			const parent = directory(dir);
			prefixes.add(parent ? `${parent}/` : '');
		}
	}
	return [...prefixes]
		.filter(prefix => ![...prefixes].some(other => other !== prefix && prefix.startsWith(other)))
		.sort();
}
