import type { Execution, ExecutionState } from '@/automation/types.ts';

export const unfinishedStates: readonly ExecutionState[] = [
	'pending',
	'ready',
	'dispatching',
	'running',
	'verifying',
	'awaiting-approval',
];

export interface Listed {
	unfinished: boolean;
	createdAt: number;
	id: string;
}

function listed(run: Execution): Listed {
	return { unfinished: unfinishedStates.includes(run.state), createdAt: run.createdAt, id: run.id };
}

export function listOrder(a: Listed, b: Listed): number {
	return Number(b.unfinished) - Number(a.unfinished) || b.createdAt - a.createdAt
		|| (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function newestActiveFirst(a: Execution, b: Execution): number {
	return listOrder(listed(a), listed(b));
}

export const executionOrderSql = `state IN (${
	unfinishedStates.map(state => `'${state}'`).join(',')
}) DESC, json_extract(document,'$.createdAt') DESC, updated_at DESC, id`;
