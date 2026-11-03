import { type Schema, Validator } from '@cfworker/json-schema';
import type { PackageURLTypeDefinition, PURLComponentDefinition } from '@/package-url/definition.generated';
import schema from '@/package-url/type-definition.schema.json';

export type TypeDefinition = PackageURLTypeDefinition;
export type ComponentDefinition = PURLComponentDefinition & { requirement?: 'required' | 'optional' | 'prohibited' };
const validator = new Validator(schema as Schema, '7', false);

/** Validate the original upstream schema; the TypeScript model is generated from that same schema. */
export function parseTypeDefinition(value: unknown): TypeDefinition {
	const result = validator.validate(value);
	if (!result.valid) throw new Error(`Invalid PURL type definition: ${JSON.stringify(result.errors)}`);
	return value as TypeDefinition;
}
