import { Clock, Context, Effect, Layer } from 'effect';
import { preparedSnapshot } from '@/automation/preparation-pull-requests';
import { ReleaseWorkflowLauncher } from '@/automation/release-workflow-launcher.ts';
import { Automation } from '@/automation/service.ts';
import { matchesPackage } from '@/domain/package-identity.ts';
import { recover } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logFailure } from '@/kernel/logging/failure-log.ts';
import { sha } from '@/kernel/schema/result.ts';
import type { Committed } from '@/persistence/durable/journal.ts';
import type { Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { PublicationLedger } from '@/publication/ledger/service.ts';
import { PublishPacing, paced } from '@/publication/publish-pace.ts';
import type { ReleaseSetRecord, ReleaseWake } from '@/release/adapters/do/keys.ts';
import { Keys, wakeDue } from '@/release/adapters/do/keys.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { compileReleaseSet } from '@/release/domain/release-set.ts';
import { reconcileInterval } from '@/release/services/coordinator/alarm-planner.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export interface ReleaseOperation {
	id: string;
	operation: string;
	paced: boolean;
	dependencies: string[];
}

const interruption = 'Release coordination interrupted. Check coordination to resume.';

export class ReleaseSets extends Context.Service<ReleaseSets, {
	readonly start: (preparationId: string, target: string) => Effect.Effect<Execution[], DomainError>;
	readonly operations: (preparationId: string, workflowId: string) => Effect.Effect<ReleaseOperation[], DomainError>;
	readonly reserve: (preparationId: string, workflowId: string, id: string) => Effect.Effect<number, DomainError>;
	readonly delay: (preparationId: string, workflowId: string, id: string) => Effect.Effect<number, DomainError>;
	readonly advance: <R>(
		preparationId: string,
		workflowId: string,
		id: string,
		reconcile: (id: string) => Effect.Effect<void, DomainError, R>,
	) => Effect.Effect<Execution['state'], DomainError, R>;
	readonly interrupted: (preparationId: string, workflowId: string) => Effect.Effect<void, DomainError>;
	readonly complete: (preparationId: string, workflowId: string) => Effect.Effect<void, DomainError>;
	/** Persist wake-ups separately so failed delivery survives Worker restarts. */
	readonly wake: Effect.Effect<void, DomainError>;
	readonly deliver: (now: number) => Effect.Effect<void, DomainError>;
	readonly resume: (execution: Execution) => Effect.Effect<void, DomainError>;
	readonly rateLimited: (
		execution: Execution,
		runId: number,
		limited: readonly number[],
	) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/ReleaseSets') {
	static readonly layer = Layer.effect(
		ReleaseSets,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const storage = yield* DurableStorage;
			const executions = yield* Executions;
			const ledger = yield* PublicationLedger;
			const pacing = yield* PublishPacing;
			const launcher = yield* ReleaseWorkflowLauncher;

			const record = (preparationId: string) => storage.get(Keys.releaseSet, preparationId);
			const put = Effect.fnUntraced(function*(preparationId: string, value: ReleaseSetRecord) {
				const preparation = yield* executions.get(preparationId);
				yield* executions.commit([
					{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value },
				]);
			});
			const operations = Effect.fnUntraced(function*(preparationId: string, workflowId: string) {
				const release = yield* record(preparationId);
				if (!release || release.workflowId !== workflowId) {
					return yield* precondition('Release Workflow identity mismatch');
				}
				return yield* Effect.forEach(
					release.ids,
					id =>
						executions.get(id).pipe(Effect.map((execution): ReleaseOperation => ({
							id,
							operation: execution.package ? `${execution.operation} ${execution.package.id}` : execution.operation,
							paced: paced(execution.package?.manager),
							dependencies: execution.dependencies,
						}))),
					{ concurrency: 'unbounded' },
				);
			});
			const remaining = Effect.fnUntraced(function*(id: string) {
				const now = yield* Clock.currentTimeMillis;
				return Math.max(0, ((yield* executions.get(id)).notBefore ?? 0) - now);
			});
			const member = Effect.fnUntraced(function*(preparationId: string, workflowId: string, id: string) {
				const listed = yield* operations(preparationId, workflowId);
				if (!listed.some(operation => operation.id === id)) {
					return yield* precondition('Operation is not in this release');
				}
			});
			const workflowError = Effect.fnUntraced(function*(
				preparationId: string,
				workflowId: string,
				error: string | undefined,
			) {
				for (const operation of yield* operations(preparationId, workflowId)) {
					const execution = yield* executions.get(operation.id);
					if (!execution.releaseSet) continue;
					execution.releaseSet.workflowError = error;
					yield* executions.commit([
						{ entity: 'execution', id: execution.id, repositoryId: execution.repositoryId, value: execution },
					]);
				}
			});
			const deliverWake = Effect.fnUntraced(function*(
				preparationId: string,
				release: ReleaseSetRecord & { workflowId: string },
				wake: ReleaseWake,
			) {
				const workflowId = release.workflowId;
				if (!release.started) {
					const preparation = yield* executions.get(preparationId);
					yield* launcher.create(workflowId, { repositoryId: preparation.repositoryId, preparationId }).pipe(
						// A create response can be lost after Cloudflare accepts the instance.
						Effect.catch(error =>
							launcher.get(workflowId).pipe(
								Effect.flatMap(instance => instance.status),
								Effect.mapError(() => error),
							)
						),
					);
					release.started = true;
					yield* put(preparationId, release);
				}
				const instance = yield* launcher.get(workflowId);
				const status = yield* instance.status;
				if (['errored', 'terminated'].includes(status)) yield* workflowError(preparationId, workflowId, interruption);
				if (!['complete', 'errored', 'terminated'].includes(status)) {
					const members = wake === true ? undefined : wake.members;
					for (const id of release.ids.filter(id => !members || members.includes(id))) {
						yield* instance.notify(id);
					}
				}
			});

			return ReleaseSets.of({
				start: Effect.fnUntraced(function*(preparationId: string, target: string) {
					const now = yield* Clock.currentTimeMillis;
					const preparation = yield* executions.get(preparationId);
					if (yield* automation.suspended(preparation.repositoryId)) {
						return yield* precondition('Repository is suspended');
					}
					const prior = yield* record(preparationId);
					if (prior) {
						if (prior.target !== target) return yield* precondition('Release set already targets another revision');
						return yield* Effect.forEach(prior.ids, id => executions.get(id), { concurrency: 'unbounded' });
					}
					const result = preparation.managed?.result ?? preparation.prepared?.result;
					const plan = preparation.managed?.plan ?? preparation.plan;
					if (!result || !plan) return yield* precondition('Preparation result unavailable');
					const revision = yield* Effect.fromResult(sha(target));
					const snapshot = yield* preparedSnapshot(
						automation.gateway,
						preparation.repository,
						preparation.repositoryId,
						result,
						revision,
						(preparation.prepared?.edits ?? plan.edits).map(edit => edit.path),
					);
					for (const edit of preparation.prepared?.edits ?? []) {
						if (snapshot.files[edit.path] !== edit.after) {
							return yield* precondition(`Generated preparation file changed: ${edit.path}`);
						}
					}
					const compiled = yield* compileReleaseSet(preparation, snapshot);
					const workflowId = `release-${preparationId}`;
					for (const execution of compiled) {
						if (execution.releaseSet) {
							execution.releaseSet.workflowId = workflowId;
							execution.releaseSet.operationCount = compiled.length;
						}
					}
					const value: ReleaseSetRecord = { target, ids: compiled.map(execution => execution.id), workflowId };
					const members = compiled.map((execution): Committed => ({
						entity: 'execution',
						id: execution.id,
						repositoryId: execution.repositoryId,
						value: execution,
					}));
					yield* executions.commit(
						[{ entity: 'release-set', id: preparationId, repositoryId: preparation.repositoryId, value }, ...members],
						[Keyspace.write(Keys.releaseWake, preparationId, { due: now })],
					);
					return compiled;
				}),
				operations,
				reserve: Effect.fnUntraced(function*(preparationId: string, workflowId: string, id: string) {
					const listed = yield* operations(preparationId, workflowId);
					const execution = listed.some(operation => operation.id === id) ? yield* executions.get(id) : undefined;
					const target = execution?.package;
					if (!execution || !target || !paced(target.manager)) {
						return yield* precondition('Operation is not a paced publication in this release');
					}
					const { kind, allowedAt } = yield* ledger.reserve(
						execution.repositoryId,
						target.manager,
						pkg => matchesPackage(target.id, pkg),
						execution.id,
						execution.reservation,
					);
					if (!execution.reservation || allowedAt > (execution.notBefore ?? 0)) {
						yield* executions.put({
							...execution,
							reservation: kind,
							notBefore: Math.max(execution.notBefore ?? 0, allowedAt),
						});
					}
					return yield* remaining(id);
				}),
				delay: Effect.fnUntraced(function*(preparationId: string, workflowId: string, id: string) {
					yield* member(preparationId, workflowId, id);
					return yield* remaining(id);
				}),
				advance: (preparationId, workflowId, id, reconcile) =>
					member(preparationId, workflowId, id).pipe(
						Effect.andThen(reconcile(id)),
						Effect.andThen(executions.get(id)),
						Effect.map(execution => execution.state),
					),
				interrupted: (preparationId, workflowId) => workflowError(preparationId, workflowId, interruption),
				complete: Effect.fnUntraced(function*(preparationId: string, workflowId: string) {
					for (const operation of yield* operations(preparationId, workflowId)) {
						if ((yield* executions.get(operation.id)).state !== 'succeeded') {
							return yield* precondition('Release is incomplete');
						}
					}
					const release = yield* record(preparationId);
					if (!release) return yield* precondition('Release set is missing');
					yield* put(preparationId, { ...release, completed: true });
				}),
				wake: Effect.gen(function*() {
					const now = yield* Clock.currentTimeMillis;
					const wakes: Write[] = [];
					for (const { id, value: release } of yield* storage.list(Keys.releaseSet)) {
						if (!release.workflowId || release.completed) continue;
						wakes.push(Keyspace.write(Keys.releaseWake, id, { due: now }));
					}
					if (wakes.length) yield* storage.writeAll(wakes);
				}),
				deliver: Effect.fnUntraced(function*(now: number) {
					for (const entry of yield* storage.entries(Keys.releaseWake)) {
						const preparationId = entry.id;
						if (entry.kind === 'unreadable') {
							yield* storage.remove(Keys.releaseWake, preparationId);
							continue;
						}
						const wake = entry.value;
						if (wakeDue(wake) > now) continue;
						const release = yield* record(preparationId);
						const workflowId = release?.workflowId;
						if (!release || !workflowId || release.completed) {
							yield* storage.remove(Keys.releaseWake, preparationId);
							continue;
						}
						yield* deliverWake(preparationId, { ...release, workflowId }, wake).pipe(
							Effect.andThen(storage.remove(Keys.releaseWake, preparationId)),
							recover(error =>
								Effect.gen(function*() {
									yield* storage.put(Keys.releaseWake, preparationId, {
										...(wake === true ? {} : wake),
										due: now + reconcileInterval,
									});
									yield* logFailure('release-wake.failed', error, { preparationId });
								})
							),
						);
					}
				}),
				resume: Effect.fnUntraced(function*(execution: Execution) {
					const releaseSet = execution.releaseSet;
					const workflowId = releaseSet?.workflowId;
					if (!releaseSet || !workflowId) return;
					const instance = yield* launcher.get(workflowId);
					if (['errored', 'terminated'].includes(yield* instance.status)) {
						yield* instance.restart;
						yield* workflowError(releaseSet.preparationId, workflowId, undefined);
					}
				}),
				rateLimited: Effect.fnUntraced(function*(execution: Execution, runId: number, limited: readonly number[]) {
					const until = Math.max(yield* Clock.currentTimeMillis, ...limited);
					yield* pacing.defer(execution.package?.manager, until);
					yield* executions.put({
						...execution,
						state: 'ready',
						supersededRuns: [...(execution.supersededRuns ?? []), runId],
						runId: undefined,
						runAttempt: undefined,
						github: undefined,
						workflowSha: undefined,
						notBefore: until,
						reason: `Registry rate limit until ${new Date(until).toISOString()}`,
						publications: execution.publications.map(publication =>
							publication.outcome === 'rate-limited' ? { ...publication, outcome: 'pending' } : publication
						),
					});
				}),
			});
		}),
	);
}
