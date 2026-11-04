import { z } from 'zod';
import { createExecution } from '@/automation/execution';
import { matchesRef } from '@/automation/policy';
import { issueWorkflowToken } from '@/automation/token';
import type { Artifact, Execution, Publication } from '@/automation/types';
import { isLockfile, reportableManagerNames } from '@/contract/catalog';
import { forbidden, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { type EnrolledContext, workflow, workflowToken } from '@/server/handlers/kit';

const outcomes = ['pending', 'succeeded', 'failed', 'uncertain', 'skipped', 'rate-limited'] as const;
const reportedFields = z.object({
	id: z.string().min(1),
	manager: z.enum(reportableManagerNames, { message: 'Invalid publication' }),
	name: z.string().min(1),
	version: z.string().min(1),
	required: z.unknown().optional(),
	digest: z.string().min(1).optional(),
	url: z.string().min(1).optional(),
	channel: z.string().min(1).optional(),
	outcome: z.enum(outcomes, { message: 'Invalid publication' }),
	retryAfter: z.unknown().optional(),
});
function publication(raw: unknown): Publication {
	const { required, outcome, retryAfter, ...fields } = reportedFields.parse(raw);
	const common = { ...fields, required: required !== false };
	if (outcome !== 'rate-limited') return { ...common, outcome };
	return { ...common, outcome, retryAfter: z.iso.datetime({ offset: true }).parse(retryAfter) };
}
const artifact: z.ZodType<Artifact> = z.object({
	id: z.number().int().positive(),
	runId: z.number().int().positive(),
	name: z.string().min(1),
	digest: z.string().min(1),
	expiresAt: z.string().min(1),
});

async function owned(context: EnrolledContext, id: string): Promise<Execution> {
	const execution = await context.service.store.execution(id);
	if (!execution || execution.repositoryId !== context.identity.repositoryId) {
		throw forbidden('Execution repository mismatch');
	}
	return execution;
}

async function bound(context: EnrolledContext, id: string): Promise<Execution> {
	const execution = await owned(context, id);
	const { identity } = context;
	if (
		execution.runId !== identity.runId
		|| execution.runAttempt !== identity.attempt
		|| execution.workflowSha !== identity.workflowSha
	) {
		throw forbidden('Execution run mismatch');
	}
	return execution;
}

async function observed(context: EnrolledContext, stream: string, operation: string, version?: string) {
	const { identity, service } = context;
	const execution = await createExecution(
		context.enrollment,
		stream,
		operation,
		`observed:${identity.runId}`,
		version,
		true,
	);
	execution.sourceSha = identity.sha;
	execution.state = 'pending';
	if (execution.operation === 'promote') throw precondition('Promotion must be approved before registration');
	if (!execution.workflow) throw precondition('Operation is not a workflow');
	if (!matchesRef(execution.workflow.ref, identity.ref)) {
		throw precondition('Observed run does not match configured ref');
	}
	await service.coordinator(identity.repositoryId).enqueue(execution);
	return execution.id;
}

export const workflowEndpoints = {
	workflowToken: workflowToken(
		routes.workflowToken,
		(input, { env, identity, service }) =>
			issueWorkflowToken(identity, input, Number(env.OWNER_ID), service.gateway, service.store),
	),
	workflowBegin: workflow(routes.workflowBegin, async (input, context) => {
		const id = input.executionId || await observed(
			context,
			z.string().min(1).parse(input.stream),
			z.string().min(1).parse(input.operation),
			input.version === undefined ? undefined : z.string().min(1).parse(input.version),
		);
		const execution = await owned(context, id);
		if (execution.operation === 'promote') await context.service.prepareJsr(execution);
		return context.service.coordinator(context.identity.repositoryId).register(id, context.identity);
	}),
	workflowRefsPlan: workflow(
		routes.workflowRefsPlan,
		(input, { identity, service }) =>
			service.coordinator(identity.repositoryId).refs(input.executionId, identity, false),
	),
	workflowRefsComplete: workflow(
		routes.workflowRefsComplete,
		(input, { identity, service }) =>
			service.coordinator(identity.repositoryId).refs(input.executionId, identity, true),
	),
	workflowRelease: workflow(
		routes.workflowRelease,
		(input, { identity, service }) =>
			service.coordinator(identity.repositoryId).publishRelease(input.executionId, identity),
	),
	workflowPrepared: workflow(routes.workflowPrepared, async (input, context) => {
		const execution = await bound(context, input.executionId);
		const { gateway, store } = context.service;
		const plan = execution.plan;
		if (execution.operation !== 'prepare' || !plan) throw precondition('Execution has no preparation plan');
		const source = await gateway.snapshot(
			execution.repository,
			execution.repositoryId,
			execution.sourceSha,
			plan.edits.map(edit => edit.path),
		);
		const proposed = input.files.map(file => ({ path: file.path, after: file.content }));
		if (new Set(proposed.map(file => file.path)).size !== proposed.length) {
			throw precondition('Duplicate prepared path');
		}
		const allowedLocks = new Set(Object.keys(source.files).filter(isLockfile));
		if ([...allowedLocks].some(path => !proposed.some(file => file.path === path))) {
			throw precondition('Prepared release is missing a lockfile');
		}
		const token = await gateway.token(execution.repository, execution.repositoryId);
		const edits = [];
		for (const file of proposed) {
			const planned = plan.edits.find(edit => edit.path === file.path);
			if (!planned && !allowedLocks.has(file.path)) throw precondition('Prepared file is outside the release plan');
			if (planned && file.after !== planned.after) {
				throw precondition('Prepared manifest differs from the approved plan');
			}
			const before = (await gateway.file(execution.repository, file.path, execution.sourceSha, token)) ?? '';
			edits.push({ path: file.path, before, after: file.after });
		}
		if (plan.edits.some(edit => !proposed.some(file => file.path === edit.path))) {
			throw precondition('Prepared release is missing a planned edit');
		}
		if (!edits.length) return { unchanged: true };
		const result = await context.service.coordinator(execution.repositoryId).prepared(
			execution.id,
			context.identity,
			edits,
		);
		await store.audit(`run:${context.identity.runId}`, 'release.prepared', result.url);
		return result;
	}),
	workflowReport: workflow(routes.workflowReport, async (input, context) => {
		await bound(context, input.executionId);
		return context.service.coordinator(context.identity.repositoryId).report(
			input.executionId,
			context.identity,
			(input.publications ?? []).map(publication),
			(input.artifacts ?? []).map(raw => artifact.parse(raw)),
		);
	}),
	workflowCredentials: workflow(routes.workflowCredentials, async (input, context) => {
		const execution = await bound(context, input.executionId);
		const allowed = execution.configuration.streams[execution.stream]?.credentials ?? [];
		const values: Record<string, string> = {};
		for (const alias of input.aliases) {
			if (!allowed.includes(alias)) throw forbidden('Alias not requested by the stream');
			values[alias] = await context.service.vault().runtime(alias, execution.operation, context.identity);
		}
		return values;
	}),
} as const;
