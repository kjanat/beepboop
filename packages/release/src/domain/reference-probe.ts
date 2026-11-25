import { Result } from 'effect';
import { identifiedManagers, isManagerName, managerSpec } from '@/domain/catalog.ts';
import { identityPackageName, matchesPublication, parseReleaseIdentity } from '@/domain/package-identity.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import type { Publication } from '@/publication/publication.ts';

type PublicationName = Pick<Publication, 'manager' | 'name'>;

function legacyPublicationName(reference: string): PublicationName | undefined {
	const colon = reference.indexOf(':');
	const manager = reference.slice(0, colon);
	const name = reference.slice(colon + 1);
	if (colon > 0 && name && isManagerName(manager)) return { manager, name };
}

function identityPublicationName(identity: PackageIdentity): PublicationName | undefined {
	const manager = identifiedManagers.find(name => managerSpec(name).purlType === identity.type);
	if (manager) return { manager, name: identityPackageName(identity) };
}

export function referenceProbe(reference: string, version?: string): Publication | undefined {
	const target = resolvePublicationTarget(reference, [], version);
	if (!target) return undefined;
	const { manager, name, identity } = target;
	return {
		id: reference,
		manager,
		name,
		version: target.version,
		outcome: 'pending',
		required: true,
		...(identity && { identity: { ...identity, version: target.version } }),
	};
}

function publicationName(id: string, identity?: PackageIdentity) {
	if (!identity) return legacyPublicationName(id);
	if (identity.type === 'generic' && identity.namespace && isManagerName(identity.namespace)) {
		return { manager: identity.namespace, name: identity.name };
	}
	return identityPublicationName(identity);
}

export function resolvePublicationTarget(id: string, reports: readonly Publication[], executionVersion?: string) {
	const parsed = id.startsWith('pkg:') ? parseReleaseIdentity(id) : undefined;
	if (parsed && Result.isFailure(parsed)) return undefined;
	const identity = parsed?.success;
	const report = reports.find(publication => matchesPublication(id, publication));
	const target = report ?? publicationName(id, identity);
	const pinnedVersion = identity?.version ?? report?.version;
	const version = pinnedVersion ?? executionVersion;
	if (target && version) {
		return {
			manager: target.manager,
			name: target.name,
			identity: identity ?? report?.identity,
			version,
			pinnedVersion,
		};
	}
}
