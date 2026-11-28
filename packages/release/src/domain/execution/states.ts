import { Schema } from 'effect';
import { mutableStruct } from '@/kernel/schema/structs.ts';

export const executionStates = [
	'pending',
	'awaiting-approval',
	'blocked',
	'ready',
	'dispatching',
	'running',
	'verifying',
	'succeeded',
	'failed',
	'cancelled',
	'uncertain',
] as const;
export type ExecutionState = (typeof executionStates)[number];
export const settledStates: readonly ExecutionState[] = ['succeeded', 'failed', 'cancelled'];
export const retiredStates: readonly ExecutionState[] = ['failed', 'cancelled'];
export const runningStates: readonly ExecutionState[] = ['dispatching', 'running', 'uncertain'];

export const approvalRequest = mutableStruct({ actor: Schema.String, sourceSha: Schema.String });
