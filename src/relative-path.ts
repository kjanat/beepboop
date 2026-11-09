export function hasPathSegment(path: string, segments: readonly string[]): boolean {
	return path.split(/[\\/]/).some(part => segments.includes(part));
}

export function unsafeRelativePath(path: string, segments: readonly string[]): boolean {
	return /^[\\/]|^[A-Za-z]:/.test(path) || hasPathSegment(path, segments);
}

export function parentDirectory(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function walkRelative(base: string, relative: string): { path: string; escaped: boolean } {
	const parts = base ? base.split('/') : [];
	let escaped = false;
	for (const part of relative.split('/')) {
		if (!part || part === '.') continue;
		if (part !== '..') parts.push(part);
		else if (!parts.pop()) escaped = true;
	}
	return { path: parts.join('/'), escaped };
}
