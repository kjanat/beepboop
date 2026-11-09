import { Result } from 'effect';
import type { ManagerDestinationId } from '@/contract/catalog';
import {
	destinationLabels,
	destinationOfPurlType,
	isManagerName,
	legacyJsrIdentity,
	managerSpec,
} from '@/contract/catalog';
import { parsePackageIdentity } from '@/package-url';

interface PackageName {
	name: string;
	destination?: ManagerDestinationId;
}

function parts(value: string): PackageName {
	if (!value.startsWith('pkg:')) {
		const colon = value.indexOf(':');
		const prefix = value.slice(0, colon);
		const destination = isManagerName(prefix) ? managerSpec(prefix).destinations?.primary : undefined;
		return colon > 0 ? { name: value.slice(colon + 1), ...(destination ? { destination } : {}) } : { name: value };
	}
	const parsed = parsePackageIdentity(value);
	if (Result.isFailure(parsed)) return { name: value };
	const identity = parsed.success;
	const destination = destinationOfPurlType(legacyJsrIdentity(identity) ? 'jsr' : identity.type);
	return {
		name: identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name,
		...(destination ? { destination } : {}),
	};
}

export function registryPackageLabel(destination: ManagerDestinationId, name: string): string {
	return `${name} on ${destinationLabels[destination]}`;
}

export function packageLabel(value: string): string {
	const { name, destination } = parts(value);
	return destination ? registryPackageLabel(destination, name) : name;
}

export function packageMarkdown(value: string): string {
	const { name, destination } = parts(value);
	return destination ? `\`${name}\` on ${destinationLabels[destination]}` : `\`${name}\``;
}
