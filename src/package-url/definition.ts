import { Validator } from '@cfworker/json-schema';
import { Data, Result } from 'effect';
import type { PackageURLTypeDefinition, PURLComponentDefinition } from '@/package-url/definition.generated';
import schema from '@/package-url/type-definition.schema.json';

export type TypeDefinition = PackageURLTypeDefinition;
export type ComponentDefinition = PURLComponentDefinition & { requirement?: 'required' | 'optional' | 'prohibited' };
const validator = new Validator(Object.fromEntries(Object.entries(schema)), '7', false);

export class InvalidTypeDefinition extends Data.TaggedError('InvalidTypeDefinition')<{ readonly message: string }> {}

function isTypeDefinition(value: unknown): value is TypeDefinition {
	return validator.validate(value).valid;
}

/** Validate the original upstream schema; the TypeScript model is generated from that same schema. */
export function parseTypeDefinition(value: unknown): Result.Result<TypeDefinition, InvalidTypeDefinition> {
	return isTypeDefinition(value)
		? Result.succeed(value)
		: Result.fail(
			new InvalidTypeDefinition({
				message: `Invalid PURL type definition: ${JSON.stringify(validator.validate(value).errors)}`,
			}),
		);
}
