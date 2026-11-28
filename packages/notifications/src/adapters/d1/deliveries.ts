import { Effect, Result, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type {
	DeliveryFields,
	DeliveryOutcome,
	NotificationDelivery,
	VersionChangedPayload,
} from '@/notifications/notification.ts';
import { versionChangedPayload } from '@/notifications/notification.ts';
import type { Sql } from '@/persistence/d1/database';
import { optionalColumn, parse } from '@/persistence/d1/database';

export const deliveryLeaseDuration = 60_000;
export const maximumDeliveryAttempts = 5;

const fields = {
	id: Schema.String,
	event_id: Schema.String,
	destination_id: Schema.String,
	document: Schema.String,
	attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	updated_at: Schema.Finite,
};
const unclaimed = { lease: Schema.Null, lease_until: Schema.Null };
const claimed = mutableStruct({
	...fields,
	state: Schema.Literal('sending'),
	lease: Schema.String.check(Schema.isMinLength(1)),
	lease_until: Schema.Finite,
	attempts: Schema.Int.check(Schema.isGreaterThan(0)),
	error: Schema.NullOr(Schema.String),
});
const delivery = Schema.Union([
	mutableStruct({ ...fields, ...unclaimed, state: Schema.Literal('pending'), error: Schema.NullOr(Schema.String) }),
	claimed,
	mutableStruct({ ...fields, ...unclaimed, state: Schema.Literal('delivered'), error: Schema.Null }),
	mutableStruct({ ...fields, ...unclaimed, state: Schema.Literal('failed'), error: Schema.String }),
]);
type DeliveryRow = Decoded<typeof delivery>;
export type ClaimedDelivery = Decoded<typeof claimed>;

function notificationDelivery(row: DeliveryRow): NotificationDelivery {
	const decoded = Result.try((): unknown => JSON.parse(row.document)).pipe(
		Result.flatMap(Schema.decodeUnknownResult(versionChangedPayload)),
	);
	const fields: DeliveryFields = {
		id: row.id,
		eventId: row.event_id,
		destinationId: row.destination_id,
		payload: Result.getOrNull(decoded),
		...(Result.isFailure(decoded) ? { payloadError: 'Invalid notification payload' } : {}),
		attempts: row.attempts,
		updatedAt: row.updated_at,
	};
	if (row.state === 'delivered') return { ...fields, state: row.state };
	if (row.state === 'failed') return { ...fields, state: row.state, error: row.error };
	return { ...fields, state: row.state, ...(row.error === null ? {} : { error: row.error }) };
}

export class NotificationDeliveries {
	constructor(private readonly sql: Sql) {}

	recent(): Effect.Effect<NotificationDelivery[], DomainError> {
		return this.sql.all('SELECT * FROM notification_deliveries ORDER BY updated_at DESC LIMIT 50').pipe(
			Effect.flatMap(rows => parse(mutableArray(delivery), rows)),
			Effect.map(rows => rows.map(notificationDelivery)),
		);
	}

	enqueue(payload: VersionChangedPayload): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.run(
				"INSERT OR IGNORE INTO notification_deliveries (id, event_id, destination_id, document, state, attempts, updated_at) SELECT ? || ':' || d.id, ?, d.id, ?, 'pending', 0, ? FROM notification_destinations d JOIN notification_subscriptions s ON s.destination_id = d.id WHERE d.enabled=1 AND s.registry=? AND s.name=?",
				payload.id,
				payload.id,
				JSON.stringify(payload),
				clock.currentTimeMillisUnsafe(),
				payload.package.registry,
				payload.package.name,
			).pipe(Effect.asVoid);
		});
	}

	available(): Effect.Effect<string[], DomainError> {
		return Effect.clockWith(clock => {
			const now = clock.currentTimeMillisUnsafe();
			return this.sql.run(
				"UPDATE notification_deliveries SET state='failed', error=COALESCE(error,'Delivery attempts exhausted'), lease=NULL, lease_until=NULL, updated_at=? WHERE attempts>=? AND (state='pending' OR (state='sending' AND lease_until<=?))",
				now,
				maximumDeliveryAttempts,
				now,
			).pipe(
				Effect.andThen(this.sql.all(
					"SELECT id FROM notification_deliveries WHERE state='pending' OR (state='sending' AND lease_until<=?) ORDER BY updated_at,id LIMIT 50",
					now,
				)),
				Effect.flatMap(rows => parse(mutableArray(mutableStruct({ id: Schema.String })), rows)),
				Effect.map(rows => rows.map(row => row.id)),
			);
		});
	}

	claim(id: string): Effect.Effect<ClaimedDelivery | undefined, DomainError> {
		return Effect.clockWith(clock => {
			const now = clock.currentTimeMillisUnsafe();
			return this.sql.first(
				"UPDATE notification_deliveries SET state='sending', lease=?, lease_until=?, attempts=attempts+1, updated_at=? WHERE id=? AND attempts<? AND (state='pending' OR (state='sending' AND lease_until<=?)) RETURNING *",
				crypto.randomUUID(),
				now + deliveryLeaseDuration,
				now,
				id,
				maximumDeliveryAttempts,
				now,
			).pipe(Effect.flatMap(optionalColumn(claimed, row => row)));
		});
	}

	owned(claim: ClaimedDelivery, revision: number): Effect.Effect<boolean, DomainError> {
		return Effect.clockWith(clock =>
			this.sql.first(
				"SELECT d.id FROM notification_deliveries d JOIN notification_destinations t ON t.id=d.destination_id WHERE d.id=? AND d.state='sending' AND d.lease=? AND d.lease_until>? AND t.enabled=1 AND t.revision=?",
				claim.id,
				claim.lease,
				clock.currentTimeMillisUnsafe(),
				revision,
			).pipe(Effect.map(row => row !== null))
		);
	}

	settle(claim: ClaimedDelivery, outcome: DeliveryOutcome): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			const state = outcome.state === 'pending' && claim.attempts >= maximumDeliveryAttempts ? 'failed' : outcome.state;
			return this.sql.run(
				"UPDATE notification_deliveries SET state=?, error=?, lease=NULL, lease_until=NULL, updated_at=? WHERE id=? AND state='sending' AND lease=? AND lease_until>?",
				state,
				outcome.state === 'delivered' ? null : outcome.error,
				clock.currentTimeMillisUnsafe(),
				claim.id,
				claim.lease,
				clock.currentTimeMillisUnsafe(),
			).pipe(Effect.asVoid);
		});
	}
}
