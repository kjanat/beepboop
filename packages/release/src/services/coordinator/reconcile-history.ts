import { Context, Effect, Layer, Ref } from 'effect';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Committed } from '@/persistence/durable/journal.ts';
import { decodeExecutionV1 } from '@/release/adapters/codecs/execution-v1.ts';
import type { ReleaseHistory } from '@/release/domain/history.ts';

export class ReconcileHistory extends Context.Service<ReconcileHistory, {
	readonly current: Effect.Effect<ReleaseHistory | undefined>;
	readonly set: (history: ReleaseHistory | undefined) => Effect.Effect<void>;
	readonly record: (entries: readonly Committed[]) => Effect.Effect<void, DomainError>;
}>()('beepboopbot/release/ReconcileHistory') {
	static readonly layer = Layer.effect(
		ReconcileHistory,
		Effect.gen(function*() {
			const history = yield* Ref.make<ReleaseHistory | undefined>(undefined);
			return ReconcileHistory.of({
				current: Ref.get(history),
				set: next => Ref.set(history, next),
				record: entries =>
					Ref.get(history).pipe(Effect.flatMap(current =>
						current === undefined ? Effect.void : fromSync(() => {
							for (const entry of entries) {
								if (entry.entity === 'execution') current.update(decodeExecutionV1(entry.value));
							}
						})
					)),
			});
		}),
	);
}
