import { Clock, Context, Effect, Layer, Ref } from 'effect';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Committed } from '@/persistence/durable/journal.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import type { Write } from '@/persistence/durable/keyspace.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { ReleaseWake } from '@/release/adapters/do/keys.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { identifyExecution } from '@/release/domain/execution/codec-v1.ts';
import { deriveExecution } from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { executionId } from '@/release/domain/identity-keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';
import { AuditTrail } from '@/release/services/coordinator/retry-queue.ts';

const settleInterval = 15_000;

export interface Journaled {
	readonly executions: Execution[];
	readonly unreadable: { id: string; error: string }[];
}

export interface ExecutionCommitted {
	readonly execution: Execution;
	readonly previous: Execution | undefined;
}

export class RepositoryRevisions extends Context.Service<RepositoryRevisions, {
	readonly inventoryAt: (
		execution: Pick<Execution, 'repository' | 'repositoryId' | 'sourceSha' | 'configuration'>,
	) => Effect.Effect<RepositoryRecord['inventory'], DomainError>;
	readonly get: (
		repositoryId: number,
	) => Effect.Effect<Pick<RepositoryRecord, 'defaultBranch' | 'inventory'> | undefined, DomainError>;
}>()('beepboopbot/release/RepositoryRevisions') {}

function wakeMembers(wake: ReleaseWake | undefined, member: string): string[] | undefined {
	if (wake === undefined) return [member];
	if (wake === true || wake.members === undefined) return undefined;
	return [...new Set([...wake.members, member])];
}

export class Executions extends Context.Service<Executions, {
	readonly read: Effect.Effect<Journaled, DomainError>;
	readonly all: Effect.Effect<Execution[], DomainError>;
	readonly stored: (id: string) => Effect.Effect<Execution | undefined, DomainError>;
	readonly get: (id: string) => Effect.Effect<Execution, DomainError>;
	readonly put: (execution: Execution) => Effect.Effect<void, DomainError>;
	readonly commit: (
		entries: readonly [Committed, ...Committed[]],
		extra?: readonly Write[],
	) => Effect.Effect<void, DomainError>;
	readonly pendingContinuations: (observed: Execution) => Effect.Effect<string[], DomainError>;
	readonly continuations: (observed: Execution) => Effect.Effect<Execution[], DomainError>;
	readonly quarantine: (id: string, error: string) => Effect.Effect<void, DomainError>;
	readonly isolate: (id: string, error: DomainError) => Effect.Effect<void, DomainError>;
	readonly onCommitted: (
		listener: (committed: ExecutionCommitted) => Effect.Effect<void, DomainError>,
	) => Effect.Effect<void>;
}>()('beepboopbot/release/Executions') {
	static readonly layer = Layer.effect(
		Executions,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const journal = yield* Journal;
			const history = yield* ReconcileHistory;
			const planner = yield* AlarmPlanner;
			const audit = yield* AuditTrail;
			const revisions = yield* RepositoryRevisions;
			const listeners = yield* Ref.make<
				readonly ((committed: ExecutionCommitted) => Effect.Effect<void, DomainError>)[]
			>(
				[],
			);
			const read = storage.entries(Keys.execution).pipe(Effect.map((entries): Journaled => {
				const executions: Execution[] = [];
				const unreadable: { id: string; error: string }[] = [];
				for (const entry of entries) {
					if (entry.kind === 'readable') executions.push(entry.value);
					else unreadable.push({ id: entry.id, error: entry.error });
				}
				return { executions, unreadable };
			}));
			const stored = (id: string) => storage.get(Keys.execution, id);
			const get = (id: string) =>
				stored(id).pipe(
					Effect.filterOrFail(
						(execution): execution is Execution => execution !== undefined,
						() => precondition('Unknown execution'),
					),
				);
			const commit = (entries: readonly [Committed, ...Committed[]], extra?: readonly Write[]) =>
				journal.commit(entries, extra).pipe(Effect.andThen(history.record(entries)));
			const pendingContinuations = Effect.fnUntraced(function*(observed: Execution) {
				if (observed.state !== 'succeeded' || !observed.eventId.startsWith('observed:')) return [];
				const bindings = Object.entries(observed.configuration.streams[observed.stream]?.workflows ?? {}).filter((
					[, binding],
				) => binding.mode !== 'observe' && binding.needs?.includes(observed.operation));
				const missing: string[] = [];
				for (const [operation] of bindings) {
					const id = yield* executionId(observed.repositoryId, observed.stream, operation, observed.eventId);
					if (!(yield* stored(id))) missing.push(operation);
				}
				return missing;
			});
			const continuations = Effect.fnUntraced(function*(observed: Execution) {
				const missing = yield* pendingContinuations(observed);
				if (!missing.length) return [];
				const record = yield* revisions.get(observed.repositoryId);
				if (!record) return yield* precondition('Repository unavailable while completing observed operation');
				const next: Execution[] = [];
				for (const operation of missing) {
					const execution = yield* deriveExecution(observed, record, {
						stream: observed.stream,
						operation,
						eventId: observed.eventId,
						sourceSha: observed.sourceSha,
						...(observed.version ? { version: observed.version } : {}),
					});
					next.push(identifyExecution(execution));
				}
				return next;
			});
			const put = Effect.fnUntraced(function*(execution: Execution) {
				Object.assign(execution, identifyExecution(execution));
				if (execution.state !== 'awaiting-approval') delete execution.approvalRequest;
				const previous = yield* stored(execution.id);
				const following = yield* continuations(execution);
				if (
					previous && previous.state !== execution.state && ['running', 'succeeded'].includes(execution.state)
					&& execution.reason === previous.reason
				) {
					delete execution.reason;
				}
				const now = yield* Clock.currentTimeMillis;
				execution.updatedAt = now;
				const extra: Write[] = [];
				const set = execution.releaseSet;
				if (!set?.workflowId) {
					extra.push(yield* planner.reconcileWrite(now + settleInterval));
				} else if (JSON.stringify({ ...previous, updatedAt: 0 }) !== JSON.stringify({ ...execution, updatedAt: 0 })) {
					const wake = yield* storage.find(Keys.releaseWake, set.preparationId);
					const members = wakeMembers(wake?.kind === 'readable' ? wake.value : undefined, execution.id);
					extra.push(
						Keyspace.write(Keys.releaseWake, set.preparationId, { ...(members ? { members } : {}), due: now }),
					);
				}
				yield* commit(
					[
						{ entity: 'execution', id: execution.id, repositoryId: execution.repositoryId, value: execution },
						...following.map((next): Committed => ({
							entity: 'execution',
							id: next.id,
							repositoryId: next.repositoryId,
							value: next,
						})),
					],
					extra,
				);
				for (const listener of yield* Ref.get(listeners)) yield* listener({ execution, previous });
			});
			const quarantine = Effect.fnUntraced(function*(id: string, error: string) {
				const at = yield* Clock.currentTimeMillis;
				yield* storage.put(Keys.quarantine, id, { error, at });
				yield* audit.record('execution.quarantined', `${id}: ${error}`, 'quarantine.audit-failed');
			});
			const isolate = (id: string, error: DomainError) => {
				const reason = `Beepboop could not continue: ${decodeError(error)}`;
				return get(id).pipe(
					Effect.flatMap(current => current.reason === reason ? Effect.void : put({ ...current, reason })),
					recover(failure => quarantine(id, decodeError(failure))),
				);
			};
			return Executions.of({
				read,
				all: read.pipe(Effect.map(journaled => journaled.executions)),
				stored,
				get,
				put,
				commit,
				pendingContinuations,
				continuations,
				quarantine,
				isolate,
				onCommitted: listener => Ref.update(listeners, registered => [...registered, listener]),
			});
		}),
	);
}
