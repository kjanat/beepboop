export function htmlEscape(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	);
}

export function link(href: string, text: string): string {
	return `<a href="${htmlEscape(href)}">${htmlEscape(text)}</a>`;
}

function encodePath(...parts: string[]): string {
	return parts.flatMap(part => part.split('/')).filter(Boolean).map(encodeURIComponent).join('/');
}

export function githubHref(repository: string, ...path: string[]): string {
	return `https://github.com/${encodePath(repository, ...path)}`;
}

export function registryHref(manager: string, name: string, version: string, repository: string): string | undefined {
	if (manager === 'npm') return `https://www.npmjs.com/package/${encodePath(name)}/v/${encodePath(version)}`;
	if (manager === 'cargo') return `https://crates.io/crates/${encodePath(name, version)}`;
	if (manager === 'go') return `https://pkg.go.dev/${encodePath(name)}@v${encodeURIComponent(version)}`;
	if (manager === 'goreleaser') return githubHref(repository, 'releases', 'tag', `v${version}`);
	return undefined;
}
