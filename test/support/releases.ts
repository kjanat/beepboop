import type { Api, Reply } from '@root/test/support/http.ts';
import { text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';

export interface ReleaseRequest {
	repositoryId: number;
	stream: string;
	version: string;
}

export async function prepareRelease(api: Api, request: ReleaseRequest): Promise<{ plan: Reply; prepared: Reply }> {
	const plan = await api('/api/releases/plan', request);
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	return { plan, prepared };
}

export async function executions(api: Api): Promise<Execution[]> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	return listed.body.map(decodeExecutionV1);
}

export function promotionsOf<T extends { operation: string }>(listed: T[]): T[] {
	return listed.filter(execution => execution.operation === 'promote');
}

export async function promotions(api: Api): Promise<Execution[]> {
	return promotionsOf(await executions(api));
}

export async function only(api: Api, operation: string): Promise<Execution> {
	return one((await executions(api)).filter(execution => execution.operation === operation), `${operation} execution`);
}

export async function approvePromotion(
	api: Api,
	sourceSha: string,
): Promise<{ promotion: Execution; approved: Reply }> {
	const promotion = await only(api, 'promote');
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha });
	return { promotion, approved };
}
