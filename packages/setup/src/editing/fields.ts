import type { Schema } from 'effect';
import { setupWorkflow } from '@/domain/workflow-setup.ts';
import { setupChoicesSchema, setupStream } from '@/setup/contract.ts';

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

export const choicesEditors = { streams: 'control', actionsRevision: 'control' } as const satisfies Editors<
	ChoicesField
>;
export const streamEditors = {
	name: 'control',
	packages: 'control',
	required: 'control',
	versioning: 'control',
	approval: 'control',
	start: 'control',
	bump: 'control',
	versionPrMerge: 'control',
	actionRelease: 'control',
	observe: 'control',
	prepare: 'control',
	release: 'control',
	versionSource: 'json',
	versionFiles: 'json',
	companionModules: 'json',
	needs: 'json',
	operations: 'json',
} as const satisfies Editors<StreamField>;
export const workflowEditors = {
	file: 'control',
	job: 'control',
	triggers: 'control',
	commands: 'control',
	publicationSteps: 'control',
	tagPrefix: 'control',
	binaries: 'control',
	credentials: 'json',
} as const satisfies Editors<WorkflowField>;
