import { Effect, Schema } from 'effect';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import { notificationKinds, watchedRegistries } from '@/domain/catalog.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { DestinationInput } from '@/notifications/contract.ts';
import type { NotificationDestination, NotificationSubscription } from '@/notifications/notification.ts';
import type { Sql } from '@/persistence/d1/database';
import { optionalColumn, parse } from '@/persistence/d1/database';

export type RevisedDestination = NotificationDestination & { revision: number };

const destinationRow = mutableStruct({
	id: Schema.String,
	name: Schema.String,
	kind: Schema.Literals(notificationKinds),
	credential: Schema.String,
	subscribe_new: Schema.Finite,
	enabled: Schema.Finite,
	created_at: Schema.Finite,
	revision: Schema.Int,
});
const subscriptionRow = mutableStruct({
	destination_id: Schema.String,
	registry: Schema.Literals(watchedRegistries),
	name: Schema.String,
});
function destination(row: Decoded<typeof destinationRow>): NotificationDestination {
	return {
		id: row.id,
		name: row.name,
		kind: row.kind,
		credential: row.credential,
		subscribeNew: row.subscribe_new === 1,
		enabled: row.enabled === 1,
		createdAt: row.created_at,
	};
}

export class NotificationDestinations {
	constructor(private readonly sql: Sql) {}

	list(): Effect.Effect<NotificationDestination[], DomainError> {
		return this.sql.all('SELECT * FROM notification_destinations ORDER BY name, id').pipe(
			Effect.flatMap(rows => parse(mutableArray(destinationRow), rows)),
			Effect.map(rows => rows.map(destination)),
		);
	}

	current(id: string): Effect.Effect<RevisedDestination | undefined, DomainError> {
		return this.sql.first('SELECT * FROM notification_destinations WHERE id=?', id).pipe(
			Effect.flatMap(optionalColumn(destinationRow, row => ({ ...destination(row), revision: row.revision }))),
		);
	}

	subscriptions(): Effect.Effect<NotificationSubscription[], DomainError> {
		return this.sql.all('SELECT destination_id, registry, name FROM notification_subscriptions ORDER BY registry, name')
			.pipe(
				Effect.flatMap(rows => parse(mutableArray(subscriptionRow), rows)),
				Effect.map(rows =>
					rows.map(row => ({ destinationId: row.destination_id, registry: row.registry, name: row.name }))
				),
			);
	}

	credentialStored(alias: string): Effect.Effect<boolean, DomainError> {
		return this.sql.first('SELECT 1 FROM credentials WHERE alias=? AND active=1', alias).pipe(
			Effect.map(saved => !!saved),
		);
	}

	save(id: string, input: DestinationInput, createdAt: number): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT INTO notification_destinations (id, name, kind, credential, subscribe_new, enabled, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, credential=excluded.credential, subscribe_new=excluded.subscribe_new, enabled=excluded.enabled, revision=notification_destinations.revision + (notification_destinations.kind<>excluded.kind OR notification_destinations.credential<>excluded.credential OR notification_destinations.enabled<>excluded.enabled)',
			id,
			input.name,
			input.kind,
			input.credential,
			Number(input.subscribeNew),
			Number(input.enabled),
			createdAt,
		).pipe(Effect.asVoid);
	}

	remove(id: string): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.batch([
				this.sql.statement('DELETE FROM notification_subscriptions WHERE destination_id=?', id),
				this.sql.statement(
					"UPDATE notification_deliveries SET state='failed', error='Destination removed', lease=NULL, lease_until=NULL, updated_at=? WHERE destination_id=? AND state IN ('pending','sending')",
					clock.currentTimeMillisUnsafe(),
					id,
				),
				this.sql.statement('DELETE FROM notification_destinations WHERE id=?', id),
			]).pipe(Effect.asVoid);
		});
	}

	setSubscription(subscription: NotificationSubscription, subscribed: boolean): Effect.Effect<void, DomainError> {
		return this.sql.run(
			subscribed
				? 'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE id=?'
				: 'DELETE FROM notification_subscriptions WHERE registry=? AND name=? AND destination_id=?',
			subscription.registry,
			subscription.name,
			subscription.destinationId,
		).pipe(Effect.asVoid);
	}

	subscribeNew(registry: WatchedRegistry, name: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE enabled=1 AND subscribe_new=1',
			registry,
			name,
		).pipe(Effect.asVoid);
	}
}
