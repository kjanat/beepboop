import { Schema } from 'effect';
import { mutableStruct } from '@/kernel/schema/structs.ts';

export const packageManifest = mutableStruct({ name: Schema.String, version: Schema.String });
