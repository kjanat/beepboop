import { unfinishedStates } from '@/release/domain/execution-order.ts';

export function validJson(path: string): string {
	return `CASE WHEN json_valid(document) THEN json_extract(document,'${path}') END`;
}

export const executionOrderSql = `state IN (${unfinishedStates.map(state => `'${state}'`).join(',')}) DESC, ${
	validJson('$.createdAt')
} DESC, id`;
