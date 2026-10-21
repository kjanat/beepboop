/** Ref patterns are deliberately limited to one trailing wildcard. */
export function validRef(value: string): boolean {
	return (
		/^(?:refs\/(?:heads|tags)\/)?[A-Za-z0-9][A-Za-z0-9._/-]*\*?$/.test(value)
		&& !value.includes('..')
		&& !value.includes('//')
	);
}
export function matchesRef(pattern: string, ref: string): boolean {
	if (!validRef(pattern) || !ref.startsWith('refs/')) return false;
	const candidates = pattern.startsWith('refs/')
		? [pattern]
		: [`refs/heads/${pattern}`, `refs/tags/${pattern}`];
	return candidates.some((value) => value.endsWith('*') ? ref.startsWith(value.slice(0, -1)) : ref === value);
}
