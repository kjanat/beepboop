import type { Api, Reply } from '@root/test/support/http.ts';
import { field, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import type { VersionPrMerge } from '@/domain/setup-terms.ts';
import { decodeExecutionV1 } from '@/release/adapters/codecs/execution-v1.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

export interface ReleaseRequest {
	repositoryId: number;
	stream: string;
	version: string;
}

export async function prepareRelease(
	api: Api,
	request: ReleaseRequest,
	preparation: { versionPrMerge?: VersionPrMerge } = {},
): Promise<{ plan: Reply; prepared: Reply }> {
	const plan = await api('/api/releases/plan', request);
	const prepared = await api('/api/releases/prepare', {
		...request,
		...preparation,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
		start: field(plan.body, 'starts') === true,
	});
	return { plan, prepared };
}

export async function executions(api: Api): Promise<Execution[]> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	return listed.body.map(decodeExecutionV1);
}

export function releasesOf<T extends { operation: string }>(listed: T[]): T[] {
	return listed.filter(execution => execution.operation === 'release');
}

export async function releaseExecutions(api: Api): Promise<Execution[]> {
	return releasesOf(await executions(api));
}

export async function only(api: Api, operation: string): Promise<Execution> {
	return one((await executions(api)).filter(execution => execution.operation === operation), `${operation} execution`);
}

export async function approveRelease(
	api: Api,
	sourceSha: string,
): Promise<{ releaseExecution: Execution; approved: Reply }> {
	const releaseExecution = await only(api, 'release');
	const approved = await api('/api/executions/approve', { id: releaseExecution.id, sourceSha });
	return { releaseExecution, approved };
}
