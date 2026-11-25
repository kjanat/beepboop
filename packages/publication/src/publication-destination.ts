import type { ManagerName } from '@/domain/catalog.ts';
import { managerSpec } from '@/domain/catalog.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import { purlDefinitions } from '@/domain/purl/index.ts';

function registryAddress(raw: string): string | undefined {
	return URL.parse(raw)?.href.replace(/\/$/, '');
}

/** Only known registries have a public package-page URL template. */
export function publicationDestination(manager: ManagerName, identity?: PackageIdentity) {
	const primary = managerSpec(manager).destinations?.primary;
	const qualifier = identity?.qualifiers?.repository_url;
	if (!identity || !qualifier) return primary;
	const registry = registryAddress(qualifier);
	if (!registry) return undefined;
	if (manager === 'vscode' && registry === 'https://open-vsx.org') return 'open-vsx';
	const registered = purlDefinitions.get(identity.type)?.repository.default_repository_url;
	if (registered && registry === registryAddress(registered)) return primary;
	return undefined;
}
