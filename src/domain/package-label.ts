import {
	destinationLabels,
	destinationOfPurlType,
	isManagerName,
	legacyJsrIdentity,
	type ManagerDestinationId,
	managerSpec,
} from '@/contract/catalog';
import { packageIdentity } from '@/package-url';

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
	try {
		const identity = packageIdentity(value);
		const destination = destinationOfPurlType(legacyJsrIdentity(identity) ? 'jsr' : identity.type);
		return {
			name: identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name,
			...(destination ? { destination } : {}),
		};
	} catch {
		return { name: value };
	}
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
