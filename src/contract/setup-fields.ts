import type { z } from 'zod';
import { setupChoicesSchema, setupStream, setupWorkflow } from '@/contract/setup';

export type ChoicesField = keyof typeof setupChoicesSchema.shape;
export type StreamField = keyof typeof setupStream.shape;
export type WorkflowField = keyof typeof setupWorkflow.shape;
export type Editor = 'control' | 'json';
export type Editors<K extends string> = Readonly<Record<K, Editor>>;

function keys<S extends z.ZodRawShape>(shape: S): (keyof S & string)[] {
	return Object.keys(shape).filter((key): key is keyof S & string => Object.hasOwn(shape, key));
}
export const choicesFields = keys(setupChoicesSchema.shape);
export const streamFields = keys(setupStream.shape);
export const workflowFields = keys(setupWorkflow.shape);

export function jsonFields<K extends string>(fields: readonly K[], editors: Editors<K>): K[] {
	return fields.filter(field => editors[field] === 'json');
}
