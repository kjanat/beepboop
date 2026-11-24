import { Clock, Context, Effect, Layer, Predicate } from 'effect';
import { CoordinatorClient } from '@/automation/coordinator-client.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { Keyspace } from '@/persistence/durable/keyspace.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { mergePublications } from '@/release/domain/execution/execution.ts';
import type { AutomationEvent, Execution, ReleaseReference } from '@/release/domain/execution/types.ts';
import { ReleaseHistory } from '@/release/domain/history.ts';
import { releaseEventId } from '@/release/domain/identity-keys.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';

export class ReleaseEventOutbox extends Context.Service<ReleaseEventOutbox, {
	readonly owed: (execution: Execution) => Effect.Effect<boolean, DomainError>;
	readonly capture: (execution: Execution) => Effect.Effect<void, DomainError>;
	readonly events: Effect.Effect<AutomationEvent[], DomainError>;
	readonly acknowledge: (id: string) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/ReleaseEventOutbox') {
	static readonly layer = Layer.effect(
		ReleaseEventOutbox,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const executions = yield* Executions;
			const history = yield* ReconcileHistory;

			const releaseGroup = Effect.fnUntraced(function*(execution: Execution) {
				if (!execution.version) return;
				const required = execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required
					?? [];
				if (!required.length) return;
				const id = releaseEventId({ ...execution, version: execution.version });
				if (yield* storage.has(Keys.releaseEmitted, id)) return;
				const releases = yield* history.current.pipe(
					Effect.filterOrElse(
						Predicate.isNotUndefined,
						() => executions.all.pipe(Effect.map(entries => new ReleaseHistory(entries))),
					),
				);
				return releases.completed(execution, required);
			});
			const capture = Effect.fnUntraced(function*(execution: Execution) {
				if (!execution.version) return;
				const group = yield* releaseGroup(execution);
				if (!group) return;
				const id = releaseEventId({ ...execution, version: execution.version });
				const references = group.flatMap(e => e.release ? [e.release] : []);
				if (references.some(r => r.tag !== references[0]?.tag || r.releaseId !== references[0]?.releaseId)) {
					return yield* precondition('Conflicting release identities');
				}
				const release: ReleaseReference = {
					id,
					...(execution.releaseSet ? { group: execution.releaseSet.group } : {}),
					repository: { id: execution.repositoryId, name: execution.repository },
					stream: execution.stream,
					commit: execution.sourceSha,
					version: execution.version,
					...(references[0]?.tag ? { tag: references[0].tag, releaseId: references[0].releaseId } : {}),
					publications: yield* mergePublications([], group.flatMap(e => e.publications)),
					artifacts: [...new Map(group.flatMap(e => e.artifacts).map(a => [a.id, a])).values()],
				};
				const event: AutomationEvent = {
					occurredAt: (yield* Clock.Clock).currentTimeMillisUnsafe(),
					id,
					source: execution.repository,
					event: 'release',
					version: execution.version,
					release,
				};
				yield* executions.commit(
					[{ entity: 'release', id, repositoryId: execution.repositoryId, value: event }],
					[Keyspace.write(Keys.releaseEvent, id, event), Keyspace.write(Keys.releaseEmitted, id, true)],
				);
			});
			yield* executions.onCommitted(({ execution }) =>
				execution.state === 'succeeded' ? capture(execution) : Effect.void
			);
			return ReleaseEventOutbox.of({
				owed: execution => releaseGroup(execution).pipe(Effect.map(group => group !== undefined)),
				capture,
				events: storage.list(Keys.releaseEvent, 100).pipe(Effect.map(entries => entries.map(entry => entry.value))),
				acknowledge: id => storage.remove(Keys.releaseEvent, id),
			});
		}),
	);
}

export class ReleaseEventSink extends Context.Service<ReleaseEventSink, {
	readonly deliver: (event: AutomationEvent) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/ReleaseEventSink') {}

export const deliverReleaseEvents = Effect.fnUntraced(function*(repositoryId: number) {
	const coordinators = yield* CoordinatorClient;
	const sink = yield* ReleaseEventSink;
	for (const event of yield* coordinators.releaseEvents(repositoryId)) {
		yield* sink.deliver(event);
		yield* coordinators.acknowledgeReleaseEvent(repositoryId, event.id);
	}
});
