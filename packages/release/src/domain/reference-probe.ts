import { Result } from 'effect';
import { identifiedManagers, isManagerName, managerSpec } from '@/domain/catalog.ts';
import { identityPackageName, parseReleaseIdentity } from '@/domain/package-identity.ts';
import type { Publication } from '@/publication/publication.ts';

export function referenceProbe(reference: string, version: string): Publication | undefined {
	if (!reference.startsWith('pkg:')) {
		const colon = reference.indexOf(':');
		const manager = reference.slice(0, colon), name = reference.slice(colon + 1);
		return colon > 0 && name && isManagerName(manager)
			? { id: reference, manager, name, version, outcome: 'pending', required: true }
			: undefined;
	}
	const parsed = parseReleaseIdentity(reference);
	if (Result.isFailure(parsed)) return undefined;
	const identity = parsed.success;
	const manager = identifiedManagers.find(name => managerSpec(name).purlType === identity.type);
	if (!manager) return undefined;
	return {
		id: reference,
		identity: { ...identity, version },
		manager,
		name: identityPackageName(identity),
		version,
		outcome: 'pending',
		required: true,
	};
}
