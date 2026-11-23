import { Schema } from 'effect';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { matchesPattern, strictStruct } from '@/kernel/schema/structs.ts';

export const nameSchema = Schema.String.check(matchesPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/));
export const outputSchema = strictStruct({
	id: nameSchema,
	kind: Schema.Literals(['archive', 'binary', 'manifest', 'package', 'checksums']),
});
export const inputSchema = strictStruct({ operation: nameSchema, output: nameSchema });
export const platformSchema = strictStruct({ os: nameSchema, arch: nameSchema, abi: Schema.optional(nameSchema) });
export type OutputDeclaration = Decoded<typeof outputSchema>;
export type InputDeclaration = Decoded<typeof inputSchema>;
export type Platform = Decoded<typeof platformSchema>;
