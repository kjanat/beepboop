import { Validator } from '@cfworker/json-schema';
import { record } from '@/model';
import type { PackageURLTypeDefinition, PURLComponentDefinition } from '@/package-url/definition.generated';
import schema from '@/package-url/type-definition.schema.json';

export type TypeDefinition = PackageURLTypeDefinition;
export type ComponentDefinition = PURLComponentDefinition & { requirement?: 'required' | 'optional' | 'prohibited' };
const validator = new Validator(record(schema), '7', false);

function isTypeDefinition(value: unknown): value is TypeDefinition {
	return validator.validate(value).valid;
}

/** Validate the original upstream schema; the TypeScript model is generated from that same schema. */
export function parseTypeDefinition(value: unknown): TypeDefinition {
	if (isTypeDefinition(value)) return value;
	throw new Error(`Invalid PURL type definition: ${JSON.stringify(validator.validate(value).errors)}`);
}
