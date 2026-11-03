import type { RegistryDestinationId } from '@/automation/destinations';

export function htmlEscape(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
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

export function registryHref(
	destination: RegistryDestinationId,
	name: string,
	version: string | undefined,
	repository: string,
): string | undefined {
	if (destination === 'npm') {
		return `https://www.npmjs.com/package/${encodePath(name)}${version ? `/v/${encodePath(version)}` : ''}`;
	}
	if (destination === 'crates-io') return `https://crates.io/crates/${encodePath(name, version ?? '')}`;
	if (destination === 'jsr') return `https://jsr.io/${name}${version ? `@${encodeURIComponent(version)}` : ''}`;
	if (destination === 'go-proxy') {
		return `https://pkg.go.dev/${encodePath(name)}${version ? `@v${encodeURIComponent(version)}` : ''}`;
	}
	if (destination === 'github-release') {
		return version
			? githubHref(repository, 'releases', 'tag', `v${version.replace(/^v/, '')}`)
			: githubHref(repository, 'releases');
	}
	if (destination === 'vscode-marketplace') {
		return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(name)}`;
	}
	if (destination === 'open-vsx') {
		const dot = name.indexOf('.');
		return dot < 1
			? undefined
			: `https://open-vsx.org/extension/${encodePath(name.slice(0, dot), name.slice(dot + 1))}`;
	}
	return undefined;
}
