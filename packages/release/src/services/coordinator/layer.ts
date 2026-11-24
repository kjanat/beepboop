import { Layer } from 'effect';
import type { ProjectionSink } from '@/persistence/durable/journal.ts';
import { Journal } from '@/persistence/durable/journal.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { journalLayout } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { CoordinatorLock } from '@/release/services/coordinator/coordinator-lock.ts';
import { ReconcileHistory } from '@/release/services/coordinator/reconcile-history.ts';
import type { AuditTrail } from '@/release/services/coordinator/retry-queue.ts';
import { InboxQueue, ObserveQueue, TrackQueue } from '@/release/services/coordinator/retry-queue.ts';

export type CoordinatorServices =
	| CoordinatorLock
	| InboxQueue
	| ObserveQueue
	| TrackQueue
	| Journal
	| ReconcileHistory
	| AlarmPlanner
	| DurableStorage;

const queues = InboxQueue.layer.pipe(Layer.provideMerge(TrackQueue.layer), Layer.provideMerge(ObserveQueue.layer));

export function coordinatorLayer(
	storage: DurableObjectStorage,
): Layer.Layer<CoordinatorServices, never, ProjectionSink | AuditTrail> {
	return Layer.mergeAll(CoordinatorLock.layer, queues).pipe(
		Layer.provideMerge(AlarmPlanner.sources),
		Layer.provideMerge(Layer.mergeAll(Journal.layer(journalLayout), ReconcileHistory.layer, AlarmPlanner.layer)),
		Layer.provideMerge(DurableStorage.layer(storage)),
	);
}
