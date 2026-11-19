import { walkRelative } from '@/kernel/path/relative-path.ts';

export function within(directory: string, change: string): string {
	if (change.startsWith('/') || change.includes('$')) return directory;
	return walkRelative(directory, change).path;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globMatches(pattern: string, name: string): boolean {
	const source = [...pattern].map(character =>
		character === '*'
			? '.*'
			: character === '?'
			? '.'
			: character === '[' || character === ']'
			? character
			: escapeRegExp(character)
	).join('');
	try {
		return new RegExp(`^${source}$`).test(name);
	} catch {
		return pattern === name;
	}
}
