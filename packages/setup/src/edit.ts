import { Schema } from 'effect';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import { setupChoicesSchema } from '@/setup/contract.ts';
import type { SetupEdit } from '@/setup/types.ts';

const setupEditSchema: Schema.Codec<SetupEdit, unknown> = mutableStruct({
	repositoryId: Schema.Finite,
	number: Schema.Finite,
	head: Schema.String,
	body: Schema.String,
	choices: setupChoicesSchema,
	due: Schema.Finite,
});

export function decodeSetupEditV1(value: unknown): SetupEdit {
	return decodeSync(setupEditSchema, value);
}
