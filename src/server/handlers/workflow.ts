import { Effect, Schema } from 'effect';
import { createExecution } from '@/automation/execution';
import { logRecovered } from '@/automation/failure-log';
import { matchesRef } from '@/automation/policy';
import { issueWorkflowToken } from '@/automation/token';
import type { Artifact, Edit, Execution, Publication } from '@/automation/types';
import { isLockfile, reportableManagerNames } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { conflict, decodeRequest, forbidden, precondition } from '@/contract/errors';
import type { ClaimStep, NextStep, ReportStep } from '@/contract/ledger';
import { startsFrom } from '@/contract/release-start';
import { routes } from '@/contract/routes';
import type { ReadyRepository } from '@/domain/repository';
import { requireReady } from '@/domain/repository';
import { fromPromise } from '@/failure';
import { mutableStruct } from '@/schema';
import type { EnrolledContext } from '@/server/handlers/kit';
import { workflow, workflowToken } from '@/server/handlers/kit';
import { beginRelease, releasePlan } from '@/server/handlers/releases';

const outcomes = ['pending', 'succeeded', 'failed', 'uncertain', 'skipped', 'rate-limited'] as const;
const reportedFields = mutableStruct({
	id: Schema.String.check(Schema.isMinLength(1)),
	manager: Schema.Literals(reportableManagerNames).annotate({ message: 'Invalid publication' }),
	name: Schema.String.check(Schema.isMinLength(1)),
	version: Schema.String.check(Schema.isMinLength(1)),
	required: Schema.optional(Schema.Unknown),
	digest: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	url: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	channel: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	outcome: Schema.Literals(outcomes).annotate({ message: 'Invalid publication' }),
	retryAfter: Schema.optional(Schema.Unknown),
});
function publication(raw: unknown): Effect.Effect<Publication, DomainError> {
	return Effect.gen(function*() {
		const { required, outcome, retryAfter, ...fields } = yield* decodeRequest(reportedFields, raw);
		const common = { ...fields, required: required !== false };
		if (outcome !== 'rate-limited') return { ...common, outcome };
		return {
			...common,
			outcome,
			retryAfter: yield* decodeRequest(
				Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)))),
				retryAfter,
			),
		};
	});
}
const artifact: Schema.Codec<Artifact, unknown> = mutableStruct({
	id: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	runId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	name: Schema.String.check(Schema.isMinLength(1)),
	digest: Schema.String.check(Schema.isMinLength(1)),
	expiresAt: Schema.String.check(Schema.isMinLength(1)),
});

function owned(context: EnrolledContext, id: string): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const execution = yield* fromPromise(() =>
			context.service.coordinator(context.identity.repositoryId).execution(id)
		);
		if (!execution || execution.repositoryId !== context.identity.repositoryId) {
			return yield* forbidden('Execution repository mismatch');
		}
		return execution;
	});
}

function bound(context: EnrolledContext, id: string): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const execution = yield* owned(context, id);
		const { identity } = context;
		if (
			execution.runId !== identity.runId
			|| execution.runAttempt !== identity.attempt
			|| execution.workflowSha !== identity.workflowSha
		) {
			return yield* forbidden('Execution run mismatch');
		}
		return execution;
	});
}

function observed(context: EnrolledContext, stream: string, operation: string, version?: string) {
	const { identity, service } = context;
	return Effect.gen(function*() {
		const enrollment = yield* requireReady(context.enrollment);
		const execution = yield* (
			createExecution(enrollment, {
				stream,
				operation,
				eventId: `observed:${identity.runId}`,
				sourceSha: identity.sha,
				version,
				observed: true,
			})
		);
		if (execution.operation === 'promote') {
			return yield* precondition('The release must be published in Beepboop before registration');
		}
		if (!execution.workflow) return yield* precondition('Operation is not a workflow');
		if (!matchesRef(execution.workflow.ref, identity.ref)) {
			return yield* precondition('Observed run does not match configured ref');
		}
		if (identity.ref.startsWith('refs/tags/')) execution.refNamespace = 'tags';
		else if (identity.ref.startsWith('refs/heads/')) execution.refNamespace = 'heads';
		yield* fromPromise(() => service.coordinator(identity.repositoryId).enqueue(execution));
		return execution.id;
	});
}

export const workflowEndpoints = {
	workflowToken: workflowToken(
		routes.workflowToken,
		(input, { env, identity, service }) =>
			issueWorkflowToken(identity, input, Number(env.OWNER_ID), service.gateway, {
				audit: (actor, action, target) => service.store.audit(actor, action, target),
				execution: id => fromPromise(() => service.coordinator(identity.repositoryId).execution(id)),
			}),
	),
	workflowStart: workflow(routes.workflowStart, (input, context) =>
		Effect.gen(function*() {
			const { identity, service } = context;
			if (identity.event !== 'workflow_dispatch') {
				return yield* forbidden('A release starts only from a workflow_dispatch run');
			}
			let repository = yield* requireReady(context.enrollment);
			const branch = `refs/heads/${repository.defaultBranch}`;
			if (identity.ref !== branch) return yield* forbidden(`Start the release from ${repository.defaultBranch}`);
			const file = identity.workflowRef.startsWith(`${identity.repository}/.github/workflows/`)
				? identity.workflowRef.slice(`${identity.repository}/.github/workflows/`.length, -`@${branch}`.length)
				: undefined;
			const permitted = (candidate: ReadyRepository) => {
				const start = startsFrom(candidate.configuration.streams[input.stream]?.start, 'action');
				return start?.via === 'action' && start.workflow === file
					&& identity.workflowRef === `${identity.repository}/.github/workflows/${start.workflow}@${branch}`;
			};
			if (!permitted(repository)) {
				return yield* forbidden(`${file ?? identity.workflowRef} cannot start releases of ${input.stream}`);
			}
			repository = yield* requireReady(yield* service.refresh(repository.name, repository.id));
			if (repository.sha !== identity.sha) {
				return yield* conflict(
					'stale-revision',
					`${repository.defaultBranch} moved after this run started. Run the workflow again.`,
				);
			}
			if (!permitted(repository)) {
				return yield* forbidden(`${file ?? identity.workflowRef} cannot start releases of ${input.stream}`);
			}
			const bump = (['patch', 'minor', 'major'] as const).find(kind => kind === input.version);
			const { selection, plan, planId } = yield* releasePlan({
				repositoryId: repository.id,
				stream: input.stream,
				version: bump ? { bump } : input.version,
			}, context);
			const actor = `github-actions:${identity.repository}#${identity.runId}`;
			return yield* beginRelease(service, selection, input.stream, plan, planId, actor, { via: 'action', actor });
		})),
	workflowBegin: workflow(routes.workflowBegin, (input, context) =>
		Effect.gen(function*() {
			const id = input.executionId || (yield* Effect.gen(function*() {
				const stream = yield* decodeRequest(Schema.String.check(Schema.isMinLength(1)), input.stream);
				const operation = yield* decodeRequest(Schema.String.check(Schema.isMinLength(1)), input.operation);
				const version = input.version === undefined
					? undefined
					: yield* decodeRequest(Schema.String.check(Schema.isMinLength(1)), input.version);
				return yield* observed(context, stream, operation, version);
			}));
			const execution = yield* owned(context, id);
			if (execution.operation === 'promote') yield* context.service.prepareJsr(execution);
			const registered = yield* fromPromise(() =>
				context.service.coordinator(context.identity.repositoryId).register(id, context.identity)
			);
			return {
				id: registered.id,
				repositoryId: registered.repositoryId,
				repository: registered.repository,
				stream: registered.stream,
				operation: registered.operation,
				state: registered.state,
				version: registered.version,
				sourceSha: registered.sourceSha,
				updatedAt: registered.updatedAt,
				plan: registered.plan,
				resolvedInputs: registered.resolvedInputs,
				package: registered.package,
				draftRelease: registered.draftRelease,
			};
		})),
	workflowRefsPlan: workflow(
		routes.workflowRefsPlan,
		(input, { identity, service }) =>
			fromPromise(() => service.coordinator(identity.repositoryId).refs(input.executionId, identity, false)),
	),
	workflowRefsComplete: workflow(
		routes.workflowRefsComplete,
		(input, { identity, service }) =>
			fromPromise(() => service.coordinator(identity.repositoryId).refs(input.executionId, identity, true)),
	),
	workflowRelease: workflow(
		routes.workflowRelease,
		(input, { identity, service }) =>
			fromPromise(() => service.coordinator(identity.repositoryId).publishRelease(input.executionId, identity)),
	),
	workflowPrepared: workflow(routes.workflowPrepared, (input, context) =>
		Effect.gen(function*() {
			const execution = yield* bound(context, input.executionId);
			const { gateway, store } = context.service;
			const plan = execution.plan;
			if (execution.operation !== 'prepare' || !plan) return yield* precondition('Execution has no preparation plan');
			const source = yield* gateway.snapshot(
				execution.repository,
				execution.repositoryId,
				execution.sourceSha,
				plan.edits.map(edit => edit.path),
			);
			const proposed = input.files.map(file => ({ path: file.path, after: file.content }));
			if (new Set(proposed.map(file => file.path)).size !== proposed.length) {
				return yield* precondition('Duplicate prepared path');
			}
			const allowedLocks = new Set(Object.keys(source.files).filter(isLockfile));
			if ([...allowedLocks].some(path => !proposed.some(file => file.path === path))) {
				return yield* precondition('Prepared release is missing a lockfile');
			}
			const token = yield* gateway.token(execution.repository, execution.repositoryId);
			const edits: Edit[] = [];
			for (const file of proposed) {
				const planned = plan.edits.find(edit => edit.path === file.path);
				if (!planned && !allowedLocks.has(file.path)) {
					return yield* precondition('Prepared file is outside the release plan');
				}
				if (planned && file.after !== planned.after) {
					return yield* precondition('Prepared manifest differs from the reviewed plan');
				}
				const before = (yield* gateway.file(execution.repository, file.path, execution.sourceSha, token)) ?? '';
				edits.push({ path: file.path, before, after: file.after });
			}
			if (plan.edits.some(edit => !proposed.some(file => file.path === edit.path))) {
				return yield* precondition('Prepared release is missing a planned edit');
			}
			if (!edits.length) return { unchanged: true };
			const result = yield* fromPromise(() =>
				context.service.coordinator(execution.repositoryId).prepared(execution.id, context.identity, edits)
			);
			const audit = store.audit(`run:${context.identity.runId}`, 'release.prepared', result.url)
				.pipe(logRecovered('release.prepared-audit-failed', { executionId: execution.id }));
			if (context.service.defer) context.service.defer(Effect.runPromiseWith(yield* Effect.context())(audit));
			else yield* audit;
			return result;
		})),
	workflowReport: workflow(routes.workflowReport, (input, context) =>
		Effect.gen(function*() {
			yield* bound(context, input.executionId);
			const publications = yield* Effect.forEach(input.publications ?? [], publication);
			const artifacts = yield* Effect.forEach(input.artifacts ?? [], raw => decodeRequest(artifact, raw));
			return yield* fromPromise(() =>
				context.service.coordinator(context.identity.repositoryId).report(
					input.executionId,
					context.identity,
					publications,
					artifacts,
				)
			);
		})),
	workflowPublishNext: workflow(
		routes.workflowPublishNext,
		(input, { identity, service }) =>
			fromPromise((): Promise<NextStep> =>
				service.coordinator(identity.repositoryId).publishNext(input.executionId, identity)
			),
	),
	workflowPublishClaim: workflow(
		routes.workflowPublishClaim,
		(input, { identity, service }) =>
			fromPromise((): Promise<ClaimStep> =>
				service.coordinator(identity.repositoryId).publishClaim(input.executionId, identity, input.purl, input.digest)
			),
	),
	workflowPublishReport: workflow(
		routes.workflowPublishReport,
		(input, { identity, service }) =>
			fromPromise((): Promise<ReportStep> =>
				service.coordinator(identity.repositoryId).publishReport(input.executionId, identity, input)
			),
	),
	workflowCredentials: workflow(routes.workflowCredentials, (input, context) =>
		Effect.gen(function*() {
			const execution = yield* bound(context, input.executionId);
			const allowed = execution.configuration.streams[execution.stream]?.credentials ?? [];
			const values: Record<string, string> = {};
			for (const alias of input.aliases) {
				if (!allowed.includes(alias)) return yield* forbidden('Alias not requested by the stream');
				values[alias] = yield* context.service.vault().runtime(alias, execution.operation, context.identity);
			}
			return values;
		})),
} as const;
