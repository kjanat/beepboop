import type { PackageIdentity } from '@/package-url';
import { packageIdentity, purlDefinitions } from '@/package-url';
import type { TypeDefinition } from '@/package-url/definition';

export interface PackageMetadata {
	identity: PackageIdentity;
	definition?: TypeDefinition;
	repository?: string;
	/** Effective qualifier values, separate from the components encoded in the purl. */
	qualifiers: Record<string, string>;
	warnings: { component: 'type' | 'namespace' | 'qualifiers'; key?: string; message: string }[];
}

/** Interpret type metadata without inserting defaults into, or changing, package identity. */
export function packageMetadata(input: PackageIdentity | string): PackageMetadata {
	const identity = packageIdentity(input);
	const definition = purlDefinitions.get(identity.type);
	const qualifiers: Record<string, string> = {};
	const warnings: PackageMetadata['warnings'] = [];
	if (!definition) warnings.push({ component: 'type', message: `No registered definition for type: ${identity.type}` });
	for (const qualifier of definition?.qualifiers_definition ?? []) {
		if (qualifier.default_value !== undefined) qualifiers[qualifier.key] = qualifier.default_value;
		if (qualifier.requirement === 'recommended' && !identity.qualifiers?.[qualifier.key]) {
			warnings.push({
				component: 'qualifiers',
				key: qualifier.key,
				message: `Recommended qualifier: ${qualifier.key}`,
			});
		}
	}
	Object.assign(qualifiers, identity.qualifiers);
	const registered = definition?.namespace_definition.registered_values;
	if (identity.namespace && registered && !registered.some(entry => entry.value === identity.namespace)) {
		warnings.push({ component: 'namespace', message: `Unregistered namespace: ${identity.namespace}` });
	}
	return {
		identity,
		definition,
		repository: identity.qualifiers?.repository_url ?? definition?.repository.default_repository_url,
		qualifiers,
		warnings,
	};
}
