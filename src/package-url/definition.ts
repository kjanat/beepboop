import { z } from 'zod';

const uniqueStrings = z.array(z.string()).refine(values => new Set(values).size === values.length, 'Duplicate value');
const uniqueObjects = (values: object[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length;
const component = {
	permitted_characters: z.string().refine(value => {
		try {
			new RegExp(value);
			return true;
		} catch {
			return false;
		}
	}, 'Invalid ECMA-262 regular expression').optional(),
	case_sensitive: z.boolean().optional(),
	normalization_rules: uniqueStrings.optional(),
	native_name: z.string().optional(),
	note: z.string().optional(),
};

/** Complete machine-readable type definition, corresponding to upstream schema 1.1. */
export const typeDefinitionSchema = z.strictObject({
	$schema: z.literal('https://packageurl.org/purl-schemas/purl-type-definition.schema-1.1.json').optional(),
	$id: z.string().regex(/^https:\/\/packageurl\.org\/purl-types\/[a-z0-9-]+-definition\.json$/),
	type: z.string().regex(/^[a-z][a-z0-9-.]+$/),
	type_name: z.string(),
	description: z.string(),
	repository: z.strictObject({
		use_repository: z.boolean(),
		default_repository_url: z.url().optional(),
		note: z.string().optional(),
	}),
	namespace_definition: z.object({
		...component,
		requirement: z.enum(['required', 'optional', 'prohibited']),
		registered_values: z.array(z.strictObject({
			value: z.string(),
			description: z.string(),
			reference_url: z.string().optional(),
		})).min(1).refine(uniqueObjects, 'Duplicate registered value').optional(),
	}).passthrough(),
	name_definition: z.object({ ...component, requirement: z.literal('required') }).passthrough(),
	version_definition: z.object({ ...component, requirement: z.literal('optional') }).passthrough().optional(),
	qualifiers_definition: z.array(z.strictObject({
		key: z.string(),
		requirement: z.enum(['optional', 'recommended', 'required']).optional(),
		description: z.string(),
		default_value: z.string().optional(),
		native_name: z.string().optional(),
	})).refine(uniqueObjects, 'Duplicate qualifier definition').optional(),
	subpath_definition: z.object({ ...component, requirement: z.literal('optional') }).passthrough().optional(),
	examples: uniqueStrings.refine(values =>
		values.length > 0 && values.every(value => /^pkg:[a-z][a-z0-9-.]+\//.test(value))
	),
	note: z.string().optional(),
	reference_urls: z.array(z.url()).refine(values => new Set(values).size === values.length, 'Duplicate URL').optional(),
});

export type TypeDefinition = z.infer<typeof typeDefinitionSchema>;
export type ComponentDefinition = Pick<TypeDefinition['namespace_definition'], keyof typeof component> & {
	requirement?: 'required' | 'optional' | 'prohibited';
};
