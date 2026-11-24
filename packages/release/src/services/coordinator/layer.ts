import { Layer } from 'effect';
import type { ProjectionSink } from '@/persistence/durable/journal.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { journalLayout } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';

export type CoordinatorServices = Journal | ReconcileHistory | AlarmPlanner | DurableStorage;

export function coordinatorLayer(
	storage: DurableObjectStorage,
): Layer.Layer<CoordinatorServices, never, ProjectionSink> {
	return AlarmPlanner.sources.pipe(
		Layer.provideMerge(Layer.mergeAll(Journal.layer(journalLayout), ReconcileHistory.layer, AlarmPlanner.layer)),
		Layer.provideMerge(DurableStorage.layer(storage)),
	);
}
