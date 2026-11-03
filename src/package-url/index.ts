import { PackageURL } from 'packageurl-js';
import definitions from '@/package-url/definitions.json';

export interface PackageIdentity {
	type: string;
	namespace?: string;
	name: string;
	version?: string;
	qualifiers?: Record<string, string>;
	subpath?: string;
}
interface ComponentDefinition {
	requirement?: string;
	case_sensitive?: boolean;
	permitted_characters?: string;
}
interface TypeDefinition {
	type: string;
	namespace_definition: ComponentDefinition;
	name_definition: ComponentDefinition;
	version_definition?: ComponentDefinition;
	subpath_definition?: ComponentDefinition;
	qualifiers_definition?: (ComponentDefinition & { key: string })[];
}
export const purlDefinitions = new Map<string, TypeDefinition>(
	definitions.map(definition => [definition.type, definition]),
);

/** Apply the pinned type definition without discarding qualifiers or package subpaths. */
export function packageIdentity(input: PackageIdentity | string): PackageIdentity {
	if (typeof input === 'string' && /\/@[^/]*$/.test(input.split(/[?#]/)[0] ?? '')) {
		throw new Error('Package name required');
	}
	if (typeof input === 'string') {
		const query = input.split('?')[1]?.split('#')[0];
		for (const key of new URLSearchParams(query).keys()) {
			if (key !== key.toLowerCase()) throw new Error('Qualifier keys must be lowercase');
		}
	}
	const parts = typeof input === 'string' ? PackageURL.parseString(input) : undefined;
	const raw: PackageIdentity = parts
		? {
			type: parts[0] ?? '',
			namespace: parts[1],
			name: parts[2] ?? '',
			version: parts[3],
			qualifiers: parts[4],
			subpath: parts[5],
		}
		: input as PackageIdentity;
	const type = raw.type.toLowerCase();
	if (type === 'git' && parts && raw.namespace?.includes('/')) {
		const [host, ...path] = raw.namespace.split('/');
		raw.namespace = host;
		raw.name = [...path, raw.name].join('/');
	}
	const definition = purlDefinitions.get(type);
	if (!definition) throw new Error(`Unregistered package URL type: ${type}`);
	// packageurl-js 2.x lowercases npm names, contrary to the current definition.
	// Use its core syntax validation/encoding and apply current type rules here.
	const parsed = new PackageURL(
		type === 'npm' ? 'generic' : type,
		raw.namespace,
		raw.name,
		raw.version,
		raw.qualifiers,
		raw.subpath,
	);
	parsed.type = type;
	function component(
		value: string | undefined,
		rule: ComponentDefinition | undefined,
		name: string,
	): string | undefined {
		if (rule?.requirement === 'required' && !value) throw new Error(`${type} requires ${name}`);
		if (rule?.requirement === 'prohibited' && value) throw new Error(`${type} prohibits ${name}`);
		const normalized = rule?.case_sensitive === false ? value?.toLowerCase() : value;
		if (normalized && rule?.permitted_characters && !new RegExp(rule.permitted_characters).test(normalized)) {
			throw new Error(`Invalid ${type} ${name}`);
		}
		return normalized;
	}
	const namespace = component(parsed.namespace, definition.namespace_definition, 'namespace');
	const name = component(parsed.name, definition.name_definition, 'name');
	const version = component(
		parsed.version,
		'version_definition' in definition ? definition.version_definition : undefined,
		'version',
	);
	const subpath = component(
		parsed.subpath,
		'subpath_definition' in definition ? definition.subpath_definition : undefined,
		'subpath',
	);
	for (const qualifier of definition.qualifiers_definition ?? []) {
		if (qualifier.requirement === 'required' && !parsed.qualifiers?.[qualifier.key]) {
			throw new Error(`${type} requires qualifier ${qualifier.key}`);
		}
		if (qualifier.requirement === 'prohibited' && parsed.qualifiers?.[qualifier.key]) {
			throw new Error(`${type} prohibits qualifier ${qualifier.key}`);
		}
	}
	if (type === 'cpan' && name?.includes('::')) throw new Error('CPAN requires a distribution name, not a module name');
	if (!name) throw new Error('Package name required');
	return {
		type,
		name,
		...(namespace ? { namespace } : {}),
		...(version ? { version } : {}),
		...(parsed.qualifiers && Object.keys(parsed.qualifiers).length ? { qualifiers: { ...parsed.qualifiers } } : {}),
		...(subpath ? { subpath } : {}),
	};
}

export function purl(input: PackageIdentity | string): string {
	const identity = packageIdentity(input);
	const result = new PackageURL(
		'generic',
		identity.namespace,
		identity.name,
		identity.version,
		identity.qualifiers,
		identity.subpath,
	);
	result.type = identity.type;
	if (identity.type === 'git' && identity.name.includes('/')) {
		const segments = identity.name.split('/');
		result.name = segments.pop() ?? '';
		result.namespace = [identity.namespace, ...segments].join('/');
	}
	const serialized = result.toString().replaceAll('%3A', ':');
	return identity.type === 'deb' ? serialized.replaceAll('+', '%2B') : serialized;
}

/** Versionless selection key; registry, platform and subpath distinctions remain significant. */
export function packageKey(input: PackageIdentity | string): string {
	const { version: _version, ...identity } = packageIdentity(input);
	return purl(identity);
}
