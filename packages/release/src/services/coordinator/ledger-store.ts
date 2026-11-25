import { Effect, Layer } from 'effect';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { LedgerStore } from '@/publication/ledger/service.ts';
import type { Publication } from '@/publication/publication.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { mergePublications } from '@/release/domain/execution/execution.ts';
import { Executions, RepositoryRevisions } from '@/release/services/coordinator/executions.ts';
import { RunBinder } from '@/release/services/coordinator/run-binder.ts';

export const ledgerStore = Layer.effect(
	LedgerStore,
	Effect.gen(function*() {
		const storage = yield* DurableStorage;
		const executions = yield* Executions;
		const revisions = yield* RepositoryRevisions;
		const binder = yield* RunBinder;
		const inventory = (repositoryId: number) =>
			revisions.get(repositoryId).pipe(Effect.map(record => record?.inventory));
		return LedgerStore.of({
			get: executionId => storage.get(Keys.ledger, executionId),
			all: storage.list(Keys.ledger).pipe(Effect.map(entries => entries.map(entry => entry.value))),
			put: ledger => storage.put(Keys.ledger, ledger.executionId, ledger),
			execution: executions.get,
			bind: (id, identity, expectation) =>
				binder.bind(id, identity, expectation).pipe(Effect.map(bound => bound.execution)),
			executions: executions.all,
			recordPublication: Effect.fnUntraced(function*(executionId: string, publication: Publication) {
				const execution = yield* executions.get(executionId);
				yield* executions.put({
					...execution,
					publications: yield* mergePublications(execution.publications, [publication]),
				});
			}),
			inventory,
			inventoryFor: execution =>
				execution.workflow?.backfill ? revisions.inventoryAt(execution) : inventory(execution.repositoryId),
		});
	}),
);
