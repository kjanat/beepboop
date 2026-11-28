import { Clock, Context, Effect, Layer } from 'effect';
import { ApprovalGate } from '@/automation/approval-gate.ts';
import { Dispatcher } from '@/automation/dispatcher.ts';
import { ManagedPreparation } from '@/automation/managed-preparation.ts';
import { PublicationRecheck, unresolved } from '@/automation/publication-recheck.ts';
import { ReleaseEventOutbox } from '@/automation/release-event-outbox.ts';
import { Automation } from '@/automation/service.ts';
import { recover } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { PublicationLedger } from '@/publication/ledger/service.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { publishedAfterFailure } from '@/release/domain/execution/execution.ts';
import { runningStates, settledStates } from '@/release/domain/execution/states.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { ReleaseHistory } from '@/release/domain/history.ts';
import { AlarmPlanner, reconcileInterval } from '@/release/services/coordinator/alarm-planner.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';

type Step = 'continue' | 'stop';

export class Reconciler extends Context.Service<Reconciler, {
	readonly reconcile: (onlyExecution?: string) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/Reconciler') {
	static readonly layer = Layer.effect(
		Reconciler,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const storage = yield* DurableStorage;
			const planner = yield* AlarmPlanner;
			const executions = yield* Executions;
			const history = yield* ReconcileHistory;
			const ledger = yield* PublicationLedger;
			const outbox = yield* ReleaseEventOutbox;
			const gate = yield* ApprovalGate;
			const managed = yield* ManagedPreparation;
			const dispatcher = yield* Dispatcher;
			const recheck = yield* PublicationRecheck;

			const hasAdvanceWork = Effect.fnUntraced(function*(execution: Execution) {
				if (
					(execution.state !== 'pending' && !settledStates.includes(execution.state)) || unresolved(execution)
					|| publishedAfterFailure(execution)
				) return true;
				if (yield* ledger.owesReceipts(execution)) return true;
				return execution.state === 'succeeded'
					&& ((yield* executions.pendingContinuations(execution)).length > 0 || (yield* outbox.owed(execution)));
			});
			const advance = Effect.fnUntraced(function*(
				execution: Execution,
				all: Execution[],
				active: Execution[],
				busy: Set<string>,
			): Effect.fn.Return<Step, DomainError> {
				if (yield* ledger.settleReceipts(execution)) return 'continue';
				if (yield* recheck.recheck(execution)) return 'continue';
				if (execution.state === 'succeeded') {
					if ((yield* executions.continuations(execution)).length) yield* executions.put(execution);
					else yield* outbox.capture(execution);
				}
				if (!active.includes(execution) || execution.state === 'pending') return 'continue';
				if (execution.state === 'awaiting-approval') return yield* gate.review(execution, all);
				if (execution.managed) {
					yield* managed.run(execution);
					return 'continue';
				}
				yield* dispatcher.dispatch(execution, all, active, busy);
				return 'continue';
			});

			return Reconciler.of({
				reconcile: Effect.fnUntraced(
					function*(onlyExecution?: string) {
						const clock = yield* Clock.Clock;
						const started = clock.currentTimeMillisUnsafe();
						if (!onlyExecution) yield* planner.holdReconcile(started + reconcileInterval);
						const journal = yield* executions.read;
						const quarantined = new Set(yield* storage.ids(Keys.quarantine));
						for (const entry of journal.unreadable) {
							if (!quarantined.has(entry.id)) yield* executions.quarantine(entry.id, entry.error);
						}
						const all = journal.executions.filter(execution => !quarantined.has(execution.id)).sort((a, b) =>
							a.createdAt - b.createdAt
						);
						if (all[0] && (yield* automation.suspended(all[0].repositoryId))) {
							return;
						}
						if (!onlyExecution) yield* planner.releaseReconcile;
						const active = all.filter(e => !settledStates.includes(e.state));
						const busy = new Set(active.filter(e => runningStates.includes(e.state)).map(e => e.stream));
						if (active.some(e => !e.releaseSet?.workflowId) || all.some(unresolved)) {
							yield* planner.requestReconcile(started + reconcileInterval);
						}
						yield* history.set(new ReleaseHistory(journal.executions));
						for (const execution of all) {
							if (onlyExecution ? execution.id !== onlyExecution : Boolean(execution.releaseSet?.workflowId)) continue;
							const work = yield* Effect.result(hasAdvanceWork(execution));
							if (work._tag === 'Success' && !work.success) continue;
							if (yield* automation.suspended(execution.repositoryId)) return;
							if (work._tag === 'Failure') {
								yield* executions.isolate(execution.id, work.failure);
								continue;
							}
							const outcome = yield* advance(execution, all, active, busy).pipe(
								recover(error => executions.isolate(execution.id, error).pipe(Effect.as('continue' as const))),
							);
							if (outcome === 'stop') return;
						}
					},
					Effect.ensuring(history.set(undefined)),
				),
			});
		}),
	);
}
