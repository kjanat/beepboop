import { managerSpec, type ManagerName } from '@/domain/catalog.ts';
import { type PackageIdentity, purlDefinitions } from '@/domain/purl/index.ts';
import { validRepository } from '@/domain/repository-name.ts';
import { githubHref, publicationRegistryHref } from '@/publication/links.ts';

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

function registryAddress(raw: string): string | undefined {
	return URL.parse(raw)?.href.replace(/\/$/, '');
}

/** Only known registries have a public package-page URL template. */
function destinationFor({ manager, identity }: PublicationTarget) {
	const primary = manager === 'manifest' ? 'manifest' : managerSpec(manager).destinations?.primary;
	const qualifier = identity?.qualifiers?.repository_url;
	if (!identity || !qualifier) return primary;
	const registry = registryAddress(qualifier);
	if (!registry) return undefined;
	if (manager === 'vscode' && registry === 'https://open-vsx.org') return 'open-vsx';
	const registered = purlDefinitions.get(identity.type)?.repository.default_repository_url;
	if (registered && registry === registryAddress(registered)) return primary;
	return undefined;
}

export function publicationTargetHref(
	target: PublicationTarget,
	repository: string,
	releaseTag?: string,
): string | undefined {
	const { manager, name, version, pinnedVersion } = target;
	const destination = destinationFor(target);
	if (!destination) return undefined;
	if (destination === 'manifest') return manifestHref(name);
	if (manager === 'github-release') {
		if (!validRepository(name)) return undefined;
		const local = name.toLowerCase() === repository.toLowerCase();
		const tag = pinnedVersion ?? (local ? releaseTag : undefined);
		return tag ? githubHref(name, 'releases', 'tag', tag) : undefined;
	}
	const registryVersion = manager === 'goreleaser' ? `v${version.replace(/^v/, '')}` : version;
	return publicationRegistryHref(destination, name, registryVersion, repository);
}
