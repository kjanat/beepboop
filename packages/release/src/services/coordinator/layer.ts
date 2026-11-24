import { Layer } from 'effect';
import type { ProjectionSink } from '@/persistence/durable/journal.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { journalLayout } from '@/release/adapters/do/keys.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';

export type CoordinatorServices = Journal | ReconcileHistory | DurableStorage;

export function coordinatorLayer(
	storage: DurableObjectStorage,
): Layer.Layer<CoordinatorServices, never, ProjectionSink> {
	return Layer.mergeAll(Journal.layer(journalLayout), ReconcileHistory.layer).pipe(
		Layer.provideMerge(DurableStorage.layer(storage)),
	);
}
