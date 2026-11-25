import type { ManagerName } from '@/domain/catalog.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import { validRepository } from '@/domain/repository-name.ts';
import { githubHref, publicationRegistryHref } from '@/publication/links.ts';

import { publicationDestination } from '@/publication/publication-destination.ts';

interface PublicationTarget {
	manager: ManagerName;
	name: string;
	identity?: PackageIdentity;
	version: string;
	pinnedVersion?: string;
}

function manifestHref(name: string): string | undefined {
	const [owner, repo, ...path] = name.split('/');
	if (!owner || !repo || !path.length || !/\.(?:json|rb)$/.test(name)) return undefined;
	const repository = `${owner}/${repo}`;
	if (!validRepository(repository) || path.some(part => !part || part === '.' || part === '..')) return undefined;
	return githubHref(repository, 'blob', 'HEAD', ...path);
}

export function publicationTargetHref(
	target: PublicationTarget,
	repository: string,
	releaseTag?: string,
): string | undefined {
	const { manager, name, version, pinnedVersion } = target;
	if (manager === 'manifest' && !target.identity?.qualifiers?.repository_url) return manifestHref(name);
	const destination = publicationDestination(manager, target.identity);
	if (!destination) return undefined;
	if (manager === 'github-release') {
		if (!validRepository(name)) return undefined;
		const local = name.toLowerCase() === repository.toLowerCase();
		const tag = pinnedVersion ?? (local ? releaseTag : undefined);
		return tag ? githubHref(name, 'releases', 'tag', tag) : undefined;
	}
	const registryVersion = manager === 'goreleaser' ? `v${version.replace(/^v/, '')}` : version;
	return publicationRegistryHref(destination, name, registryVersion, repository);
}
