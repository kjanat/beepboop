import { Effect } from 'effect';
import type { AutomationService } from '@/automation/service';
import { routes } from '@/contract/routes';
import { requireReady } from '@/domain/repository';
import { gitRefSchema, releaseSchema } from '@/github/resources.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { notFound, precondition } from '@/kernel/errors/domain-error.ts';
import { createExecution } from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { admin } from '@/server/handlers/kit';

const shortId = /^[0-9a-f]{8,63}$/;

function execution(
	service: AutomationService,
	id: string,
	repositoryId?: number,
): Effect.Effect<Execution, DomainError> {
	return Effect.gen(function*() {
		const matches = shortId.test(id) ? yield* service.store.executionsStarting(id) : [];
		if (matches.length > 1) return yield* precondition(`Several operations start with ${id}; give more of the ID`);
		const known = matches[0]
			?? (repositoryId === undefined && !shortId.test(id) ? yield* service.store.execution(id) : undefined);
		const owner = repositoryId ?? known?.repositoryId;
		const full = known?.id ?? id;
		const found = owner === undefined
			? undefined
			: yield* service.coordinators.execution(owner, full);
		if (!found) return yield* notFound('execution', 'Unknown execution', id);
		return found;
	});
}

export const executionEndpoints = {
	executionsList: admin(
		routes.executionsList,
		(input, { service }) =>
			Object.values(input).some(value => value !== undefined)
				? service.store.filteredExecutions(input)
				: service.store.executions(),
	),
	executionsBinaries: admin(
		routes.executionsBinaries,
		(input, { service }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => service.coordinators.binaryProgress(found.repositoryId, found.id)),
			),
	),
	executionsApproval: admin(
		routes.executionsApproval,
		(input, { service }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => service.coordinators.approvalReadiness(found.repositoryId, found.id)),
			),
	),
	executionsCancel: admin(
		routes.executionsCancel,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => service.coordinators.cancel(found.repositoryId, found.id, actor)),
			),
	),
	executionsApprove: admin(
		routes.executionsApprove,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found =>
					service.coordinators.approve(found.repositoryId, found.id, input.sourceSha, actor, input.force === true)
				),
			),
	),
	executionsChecks: admin(
		routes.executionsChecks,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => service.coordinators.resolveChecks(found.repositoryId, found.id, input.choice, actor)),
			),
	),
	executionsBackfill: admin(routes.executionsBackfill, (input, { service, actor }) =>
		Effect.gen(function*() {
			const parent = yield* execution(service, input.id, input.repositoryId);
			const release = parent.release;
			if (parent.operation !== 'promote' || !release?.tag || release.releaseId === undefined) {
				return yield* precondition('Backfill requires a promotion with a published GitHub release');
			}
			const repository = yield* requireReady(yield* service.catalog.refresh(parent.repository, parent.repositoryId));
			const binding = repository.configuration.streams[parent.stream]?.workflows[input.operation];
			if (input.operation === 'prepare' || input.operation === 'promote' || !binding?.backfill) {
				return yield* precondition('Select an operation enabled for backfills in repository configuration');
			}
			if (binding.ref && ![repository.defaultBranch, `refs/heads/${repository.defaultBranch}`].includes(binding.ref)) {
				return yield* precondition('Backfill workflow must run on the repository default branch');
			}
			const gateway = service.gateway;
			const token = yield* gateway.token(parent.repository, parent.repositoryId, { contents: 'read' });
			const base = `/repos/${parent.repository}`;
			const published = yield* gateway.read(releaseSchema, `${base}/releases/${release.releaseId}`, token);
			const ref = yield* gateway.read(gitRefSchema, `${base}/git/ref/tags/${encodeURIComponent(release.tag)}`, token);
			const target = yield* gateway.peelTag(parent.repository, ref.object, token);
			if (
				published.draft !== false || published.tag_name !== release.tag
				|| target.type !== 'commit' || target.sha !== release.commit
			) {
				return yield* precondition('Published release no longer matches the recorded tag and commit');
			}
			const backfill = yield* createExecution(repository, {
				stream: parent.stream,
				operation: input.operation,
				eventId: `backfill:${parent.id}:${repository.sha}`,
				sourceSha: release.commit,
				version: release.version,
				upstreamRelease: release,
			});
			backfill.initiatedBy = actor;
			return yield* service.enqueue(repository, backfill);
		})),
	executionsRecover: admin(
		routes.executionsRecover,
		(input, { service, actor }) =>
			execution(service, input.id, input.repositoryId).pipe(
				Effect.flatMap(found => service.coordinators.recover(found.repositoryId, found.id, input.action, actor)),
			),
	),
} as const;
