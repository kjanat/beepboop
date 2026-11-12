import { Struct } from 'effect';
import type { Configuration } from '@/domain/configuration';
import { bindingValue, configurationValue } from '@/domain/configuration-value';
import { encodeSync, mutableStruct } from '@/schema';

export const storedConfiguration = mutableStruct(Struct.omit(configurationValue.fields, ['actionsRevision']));
export const storedBinding = bindingValue;

export function encodeConfigurationV1(configuration: Configuration) {
	return encodeSync(storedConfiguration, configuration);
}
