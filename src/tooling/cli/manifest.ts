import { Schema } from 'effect';
import { mutableStruct } from '@/schema';

export const packageManifest = mutableStruct({ name: Schema.String, version: Schema.String });
