import { matchesRef } from '@/domain/ref-policy.ts';
import type { Stream } from '@/release/domain/execution/types.ts';

export interface RefShape {
	readonly tagLike: boolean;
	readonly branchLike: boolean;
}

export function refShape(patterns: readonly string[], branch: string): RefShape {
	return {
		tagLike: patterns.some(pattern => matchesRef(pattern, `refs/tags/${branch}`)) || /^v?\d+\.\d+\.\d+/.test(branch),
		branchLike: patterns.some(pattern =>
			!pattern.startsWith('refs/tags/') && matchesRef(pattern, `refs/heads/${branch}`)
		),
	};
}

export function taggedVersion(stream: Pick<Stream, 'versionSource'>, pattern: string, tag: string): string {
	const tagName = pattern.startsWith('refs/tags/')
		? pattern.slice('refs/tags/'.length)
		: pattern.startsWith('refs/')
		? undefined
		: pattern;
	const prefix = [
		stream.versionSource?.prefix,
		tagName === undefined
			? undefined
			: tagName.endsWith('*')
			? /^[^*?[]*/.exec(tagName)?.[0]?.replace(/(?<![\d.])\d[\d.]*$/, '')
			: /^(.*?)v?\d+\.\d+/.exec(tagName)?.[1],
	].filter((value): value is string => value !== undefined && tag.startsWith(value))
		.sort((a, b) => b.length - a.length)[0] ?? '';
	return tag.slice(prefix.length).replace(/^v/, '');
}
