import { Result } from 'effect';
import { identifiedManagers, isManagerName, managerSpec } from '@/domain/catalog.ts';
import { identityPackageName, parseReleaseIdentity } from '@/domain/package-identity.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import type { Publication } from '@/publication/publication.ts';

type PublicationName = Pick<Publication, 'manager' | 'name'>;

export function legacyPublicationName(reference: string): PublicationName | undefined {
	const colon = reference.indexOf(':');
	const manager = reference.slice(0, colon);
	const name = reference.slice(colon + 1);
	if (colon > 0 && name && isManagerName(manager)) return { manager, name };
}

export function identityPublicationName(identity: PackageIdentity): PublicationName | undefined {
	const manager = identifiedManagers.find(name => managerSpec(name).purlType === identity.type);
	if (manager) return { manager, name: identityPackageName(identity) };
}

export function referenceProbe(reference: string, version: string): Publication | undefined {
	const pending = { id: reference, version, outcome: 'pending', required: true } as const;
	if (!reference.startsWith('pkg:')) {
		const target = legacyPublicationName(reference);
		return target && { ...pending, ...target };
	}
	const parsed = parseReleaseIdentity(reference);
	if (Result.isFailure(parsed)) return undefined;
	const identity = parsed.success;
	const target = identityPublicationName(identity);
	return target && { ...pending, ...target, identity: { ...identity, version } };
}
