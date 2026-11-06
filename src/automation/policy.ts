import { validRef } from '@/contract/catalog';

export function matchesRef(pattern: string, ref: string): boolean {
	if (!validRef(pattern) || !ref.startsWith('refs/')) return false;
	const candidates = pattern.startsWith('refs/')
		? [pattern]
		: [`refs/heads/${pattern}`, `refs/tags/${pattern}`];
	return candidates.some((value) => value.endsWith('*') ? ref.startsWith(value.slice(0, -1)) : ref === value);
}
