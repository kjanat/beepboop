import type { Schema } from 'effect';
import { setupChoicesSchema, setupStream, setupWorkflow } from '@/contract/setup';

export type ChoicesField = keyof typeof setupChoicesSchema.fields;
export type StreamField = keyof typeof setupStream.fields;
export type WorkflowField = keyof typeof setupWorkflow.fields;
export type Editor = 'control' | 'json';
export type Editors<K extends string> = Readonly<Record<K, Editor>>;

function keys<S extends Schema.Struct.Fields>(shape: S): (keyof S & string)[] {
	return Object.keys(shape).filter((key): key is keyof S & string => Object.hasOwn(shape, key));
}
export const choicesFields = keys(setupChoicesSchema.fields);
export const streamFields = keys(setupStream.fields);
export const workflowFields = keys(setupWorkflow.fields);

export function jsonFields<K extends string>(fields: readonly K[], editors: Editors<K>): K[] {
	return fields.filter(field => editors[field] === 'json');
}
