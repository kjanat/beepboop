import { Clock, Effect, Schema } from 'effect';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { decodeDeliveryV1 } from '@/notifications/codecs.ts';
import type { Sql } from '@/persistence/d1/database';
import { parse } from '@/persistence/d1/database';
import { documentRow, rowDocument } from '@/persistence/d1/document-row';
import { decodeEventV1 } from '@/release/adapters/codecs/execution-v1.ts';
import type { AutomationEvent, SubscriptionDelivery } from '@/release/domain/execution/types.ts';

export class ReleaseEvents {
	constructor(private readonly sql: Sql) {}

	event(id: string): Effect.Effect<AutomationEvent | undefined, DomainError> {
		return this.sql.first('SELECT document FROM release_events WHERE id=?', id).pipe(
			Effect.flatMap(row => row ? fromSync(() => decodeEventV1(rowDocument(row))) : Effect.undefined),
		);
	}

	queue(event: AutomationEvent, deliveries: SubscriptionDelivery[]): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const serialized = JSON.stringify(event);
			yield* this.sql.batch([
				this.sql.statement(
					'INSERT OR IGNORE INTO release_events(id,document,created_at) VALUES(?,?,?)',
					event.id,
					serialized,
					clock.currentTimeMillisUnsafe(),
				),
				...deliveries.map(delivery =>
					this.sql.statement(
						"INSERT OR IGNORE INTO subscription_deliveries(id,event_id,repository_id,document,state,updated_at) SELECT ?,?,?,?,'pending',? WHERE EXISTS (SELECT 1 FROM release_events WHERE id=? AND document=?)",
						delivery.id,
						event.id,
						delivery.repositoryId,
						JSON.stringify(delivery),
						clock.currentTimeMillisUnsafe(),
						event.id,
						serialized,
					)
				),
			]);
			const saved = yield* parse(
				Schema.NullOr(documentRow),
				yield* this.sql.first('SELECT document FROM release_events WHERE id=?', event.id),
			);
			if (saved?.document !== serialized) return yield* precondition('Event identity changed');
		});
	}

	pending(): Effect.Effect<SubscriptionDelivery[], DomainError> {
		return this.sql.all(
			"SELECT document FROM subscription_deliveries WHERE state='pending' ORDER BY updated_at,id LIMIT 100",
		).pipe(Effect.flatMap(rows => fromSync(() => rows.map(row => decodeDeliveryV1(rowDocument(row))))));
	}

	settle(id: string, succeeded: boolean): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				'UPDATE subscription_deliveries SET state=?,error=?,updated_at=? WHERE id=?',
				succeeded ? 'delivered' : 'pending',
				succeeded ? null : 'Delivery awaiting retry',
				clock.currentTimeMillisUnsafe(),
				id,
			).pipe(Effect.asVoid);
		});
	}
}
