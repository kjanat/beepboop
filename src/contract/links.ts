import type { ManagerDestinationId, WatchedRegistry } from '@/contract/catalog';
import { defaultTagPolicy, semVer, tagFor } from '@/contract/version';

function encodePath(...parts: string[]): string {
	return parts.flatMap(part => part.split('/')).filter(Boolean).map(part =>
		encodeURIComponent(part).replaceAll('%40', '@')
	).join('/');
}

export function githubHref(repository: string, ...path: string[]): string {
	return `https://github.com/${encodePath(repository, ...path)}`;
}

const packagePages = {
	npm: name => `https://www.npmjs.com/package/${encodePath(name)}`,
	jsr: name => `https://jsr.io/${name}`,
} satisfies Record<WatchedRegistry, (name: string) => string>;
export function watchedPackageHref(registry: WatchedRegistry, name: string): string {
	return packagePages[registry](name);
}

export function registryHref(
	destination: ManagerDestinationId,
	name: string,
	version: string | undefined,
	repository: string,
): string | undefined {
	if (destination === 'npm') {
		return `${packagePages.npm(name)}${version ? `/v/${encodePath(version)}` : ''}`;
	}
	if (destination === 'pypi') {
		return `https://pypi.org/project/${encodePath(name)}/${version ? `${encodePath(version)}/` : ''}`;
	}
	if (destination === 'crates-io') return `https://crates.io/crates/${encodePath(name, version ?? '')}`;
	if (destination === 'jsr') return `${packagePages.jsr(name)}${version ? `@${encodeURIComponent(version)}` : ''}`;
	if (destination === 'go-proxy') {
		return `https://pkg.go.dev/${encodePath(name)}${version ? `@v${encodeURIComponent(version)}` : ''}`;
	}
	if (destination === 'github-release') {
		const parsed = semVer.safeParse(version);
		return parsed.success
			? githubHref(repository, 'releases', 'tag', tagFor(defaultTagPolicy, parsed.data))
			: version
			? githubHref(repository, 'releases', 'tag', version)
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
