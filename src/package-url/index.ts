import { PackageURL } from 'packageurl-js';
import { type ComponentDefinition, parseTypeDefinition, type TypeDefinition } from '@/package-url/definition';
import definitions from '@/package-url/definitions';

export type { ComponentDefinition, TypeDefinition } from '@/package-url/definition';
export type {
	KnownPackageIdentity,
	KnownPackageType,
	ProposedPackageIdentity,
	ProposedPackageType,
	RegisteredPackageIdentity,
	RegisteredPackageType,
} from '@/package-url/identity.generated';

export interface PackageIdentity {
	type: string;
	namespace?: string;
	name: string;
	version?: string;
	qualifiers?: Record<string, string>;
	subpath?: string;
}
export const purlDefinitions: ReadonlyMap<string, TypeDefinition> = new Map(
	definitions.map(value => {
		const definition = parseTypeDefinition(value);
		return [definition.type, definition];
	}),
);

function stringIdentity(
	parts: ReturnType<typeof PackageURL.parseString>,
	qualifiers: Record<string, string> | undefined,
): PackageIdentity {
	return {
		type: parts[0] ?? '',
		namespace: parts[1],
		name: parts[2] ?? '',
		version: parts[3],
		qualifiers,
		subpath: parts[5],
	};
}

/** Apply the pinned type definition without discarding qualifiers or package subpaths. */
export function packageIdentity(input: PackageIdentity | string): PackageIdentity {
	if (typeof input === 'string' && /\/@[^/]*$/.test(input.split(/[?#]/)[0] ?? '')) {
		throw new Error('Package name required');
	}
	let parseInput = input;
	let qualifiers = typeof input === 'string' ? undefined : input.qualifiers;
	if (typeof input === 'string') {
		const fragment = input.indexOf('#');
		const end = fragment < 0 ? input.length : fragment;
		const question = input.indexOf('?');
		if (question >= 0 && question < end) {
			const pairs = new Map<string, string>();
			for (const pair of input.slice(question + 1, end).split('&')) {
				const equal = pair.indexOf('=');
				if (equal < 0) throw new Error('Qualifier requires key=value');
				const key = pair.slice(0, equal);
				if (pairs.has(key)) throw new Error(`Duplicate qualifier key: ${key}`);
				pairs.set(key, decodeURIComponent(pair.slice(equal + 1)));
			}
			qualifiers = Object.fromEntries(pairs);
			parseInput = input.slice(0, question) + input.slice(end);
		}
	}
	for (const key of Object.keys(qualifiers ?? {})) {
		if (key !== key.toLowerCase()) throw new Error('Qualifier keys must be lowercase');
		if (!/^[a-z][a-z0-9._-]*$/.test(key)) throw new Error('Invalid qualifier key');
	}
	const raw: PackageIdentity = typeof parseInput === 'string'
		? stringIdentity(PackageURL.parseString(parseInput), qualifiers)
		: parseInput;
	const type = raw.type.toLowerCase();
	if (!/^[a-z][a-z0-9.-]*$/.test(type)) throw new Error('Invalid package URL type');
	if (type === 'git' && typeof parseInput === 'string' && raw.namespace?.includes('/')) {
		const [host, ...path] = raw.namespace.split('/');
		raw.namespace = host;
		raw.name = [...path, raw.name].join('/');
	}
	const definition = purlDefinitions.get(type);
	// packageurl-js 2.x lowercases npm names, contrary to the current definition.
	// Use its core syntax validation/encoding and apply current type rules here.
	// Textual name normalization from the pinned definitions. Case-sensitive Hackage
	// names keep their case; pub names use lowercase ASCII words separated by underscores.
	// See https://github.com/package-url/packageurl-js/issues/95
	// and https://github.com/package-url/packageurl-js/pull/98
	const nativeName = type === 'hackage'
		? raw.name.replace(/[_\s]+/g, '-')
		: type === 'pub'
		? raw.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
		: raw.name;
	const parsed = new PackageURL(
		!definition || type === 'npm' ? 'generic' : type,
		raw.namespace,
		nativeName,
		raw.version,
		raw.qualifiers,
		raw.subpath,
	);
	parsed.type = type;
	// PURL qualifier values are URI components, not form data: '+' is literal, and spaces are significant.
	parsed.qualifiers = qualifiers
		? Object.fromEntries(Object.entries(qualifiers).filter(([, value]) => value !== ''))
		: undefined;
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
	const namespace = component(parsed.namespace, definition?.namespace_definition, 'namespace');
	const name = component(parsed.name, definition?.name_definition, 'name');
	const version = component(
		parsed.version,
		definition?.version_definition,
		'version',
	);
	const subpath = component(
		parsed.subpath,
		definition?.subpath_definition,
		'subpath',
	);
	for (const qualifier of definition?.qualifiers_definition ?? []) {
		if (qualifier.requirement === 'required' && !parsed.qualifiers?.[qualifier.key]) {
			throw new Error(`${type} requires qualifier ${qualifier.key}`);
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
	result.qualifiers = identity.qualifiers;
	if (identity.type === 'git' && identity.name.includes('/')) {
		const segments = identity.name.split('/');
		result.name = segments.pop() ?? '';
		result.namespace = [identity.namespace, ...segments].join('/');
	}
	const serialized = result.toString().replaceAll('%3A', ':');
	return identity.type === 'deb' ? serialized.replaceAll('+', '%2B') : serialized;
}
