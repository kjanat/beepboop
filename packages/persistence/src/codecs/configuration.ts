import { Struct } from 'effect';
import type { Configuration } from '@/domain/configuration/schema.ts';
import { bindingValue, configurationValue } from '@/domain/configuration/schema.ts';
import { encodeSync, mutableStruct } from '@/kernel/schema/structs.ts';

export const storedConfiguration = mutableStruct(Struct.omit(configurationValue.fields, ['actionsRevision']));
export const storedBinding = bindingValue;

export function encodeConfigurationV1(configuration: Configuration) {
	return encodeSync(storedConfiguration, configuration);
}
