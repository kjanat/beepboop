/* Generated from pinned upstream PURL data and local extensions by bun run purl:generate. Do not edit. */

/**
 * The unique identifier URI for this PURL type definition.
 */
export type PURLTypeDefinitionId = string;
/**
 * Contains the URL of the JSON schema for Package-URL type definition.
 */
export type JSONSchema = 'https://packageurl.org/purl-schemas/purl-type-definition.schema-1.1.json';
/**
 * The description of this PURL type.
 */
export type Description = string;
/**
 * Example of valid PURLs for this package type.
 *
 * @minItems 1
 */
export type PURLExamples = [string, ...string[]];
/**
 * Definition of the name component for this PURL type. The PURL name component is required for all PURL type definitions.
 */
export type NameDefinition = PURLComponentDefinition & {
	requirement: NameComponentRequirement;
	[k: string]: unknown;
};
/**
 * true if this PURL component is case sensitive. If false, the valid form is lowercase.
 */
export type CaseSensitive = boolean;
/**
 * The native name of this PURL component in the package ecosystem. For instance, the 'namespace' for the 'maven' type is 'groupId', and 'scope' for the 'npm' PURL type.
 */
export type NativeName = string;
/**
 * List of rules to normalize this component for this PURL type. These are plain text, unstructured rules as some require programming and cannot be enforced only with a schema. Tools are expected to apply these rules programmatically.
 */
export type NormalizationRules = string[];
/**
 * Extra note text.
 */
export type Note = string;
/**
 * A regular expression (ECMA-262 dialect) defining the 'Permitted characters' for this component of this Package-URL type. If provided, this shall be a subset of the 'Permitted characters' defined in the PURL specification.
 */
export type PermittedCharactersInThisPURLComponent = string;
/**
 * States that the PURL name component is always required.
 */
export type NameComponentRequirement = ComponentRequiredRequirement & string;
/**
 * States that this PURL component is required for a PURL type.
 */
export type ComponentRequiredRequirement = 'required';
/**
 * Definition of the namespace component for this PURL type. The PURL namespace component shall be required, optional or prohibited for a specific PURL type definition.
 */
export type NamespaceDefinition = PURLComponentDefinition & {
	registered_values?: RegisteredNamespaceValues;
	requirement: NamespaceRequirement;
	[k: string]: unknown;
};
/**
 * Optional set of registered namespace values for this PURL type. If the namespace value for a PURL of this type is not one of these registered values, a tool should report a warning. The registered namespace values should be sorted lexicographically.
 *
 * @minItems 1
 */
export type RegisteredNamespaceValues = [
	{
		description: RegisteredNamespaceDescription;
		reference_url?: ReferenceURL;
		value: RegisteredNamespaceValue;
	},
	...{
		description: RegisteredNamespaceDescription;
		reference_url?: ReferenceURL;
		value: RegisteredNamespaceValue;
	}[],
];
/**
 * Explanation of what this namespace value means for this PURL type.
 */
export type RegisteredNamespaceDescription = string;
/**
 * Optional Reference URL for where this namespace value is defined for this PURL type.
 */
export type ReferenceURL = string;
/**
 * Registered namespace value for this PURL type.
 */
export type RegisteredNamespaceValue = string;
/**
 * States that the PURL namespace component is optional, required or prohibited for a PURL type.
 */
export type NamespaceRequirement =
	& (
		ComponentOptionalRequirement | ComponentRequiredRequirement | ComponentProhibitedRequirement
	)
	& string;
/**
 * States that this PURL component is optional for a PURL type.
 */
export type ComponentOptionalRequirement = 'optional';
/**
 * States that this PURL component is prohibited for a PURL type.
 */
export type ComponentProhibitedRequirement = 'prohibited';
/**
 * Note about this PURL type.
 */
export type Note1 = string;
/**
 * The optional default value of this qualifier if not provided.
 */
export type DefaultValue = string;
/**
 * The description of this qualifier key.
 */
export type Description1 = string;
/**
 * The key for the qualifier.
 */
export type QualifierKey = string;
/**
 * The equivalent native name for this qualifier key.
 */
export type NativeName1 = string;
/**
 * States that a PURL qualifier key is optional, recommended or required for a PURL type.
 */
export type QualifierKeyRequirement =
	& (
		ComponentOptionalRequirement | ComponentRecommendedRequirement | ComponentRequiredRequirement
	)
	& string;
/**
 * States that this PURL component is recommended for a PURL type.
 */
export type ComponentRecommendedRequirement = 'recommended';
/**
 * Definition of the qualifiers specific to this PURL type. The PURL qualifiers component is optional for a specific PURL type, but a qualifiers key or keys may be required for a specific PURL type.
 */
export type QualifiersDefinition = QualifiersDefinition1[];
/**
 * Optional list of informational reference URLs about this PURL type.
 */
export type ReferenceURLs = string[];
/**
 * The default public repository URL for this PURL type
 */
export type DefaultRepositoryURL = string;
/**
 * Extra note text.
 */
export type Note2 = string;
/**
 * true if this PURL type uses a public package repository.
 */
export type UseRepository = boolean;
/**
 * The definition for the subpath for this PURL type. The PURL subpath component is optional for a specific PURL type definition.
 */
export type SubpathDefinition = PURLComponentDefinition & {
	requirement: SubpathRequirement;
	[k: string]: unknown;
};
/**
 * States that the PURL subpath is optional.
 */
export type SubpathRequirement = ComponentOptionalRequirement & string;
/**
 * The type string for this Package-URL type.
 */
export type PURLType = string;
/**
 * The name for this PURL type.
 */
export type TypeName = string;
/**
 * Definition of the version component for this PURL type. The PURL version component is optional for a specific PURL type definition.
 */
export type VersionDefinition = PURLComponentDefinition & {
	requirement: VersionRequirement;
	[k: string]: unknown;
};
/**
 * States that the PURL version is optional.
 */
export type VersionRequirement = ComponentOptionalRequirement & string;

/**
 * Schema to specify a Package-URL (PURL) type as a structured definition.
 */
export interface PackageURLTypeDefinition {
	$id: PURLTypeDefinitionId;
	$schema?: JSONSchema;
	description: Description;
	examples: PURLExamples;
	name_definition: NameDefinition;
	namespace_definition: NamespaceDefinition;
	note?: Note1;
	qualifiers_definition?: QualifiersDefinition;
	reference_urls?: ReferenceURLs;
	repository: Repository;
	subpath_definition?: SubpathDefinition;
	type: PURLType;
	type_name: TypeName;
	version_definition?: VersionDefinition;
}
/**
 * PURL component definition properties that apply to most PURL components
 */
export interface PURLComponentDefinition {
	case_sensitive?: CaseSensitive;
	native_name?: NativeName;
	normalization_rules?: NormalizationRules;
	note?: Note;
	permitted_characters?: PermittedCharactersInThisPURLComponent;
	[k: string]: unknown;
}
/**
 * The definition of a qualifier specific to this PURL type.
 */
export interface QualifiersDefinition1 {
	default_value?: DefaultValue;
	description: Description1;
	key: QualifierKey;
	native_name?: NativeName1;
	requirement?: QualifierKeyRequirement;
}
/**
 * The package repository usage for this PURL type.
 */
export interface Repository {
	default_repository_url?: DefaultRepositoryURL;
	note?: Note2;
	use_repository: UseRepository;
}
