import { Effect, Schema } from 'effect';
import type { DomainError } from '@/contract/errors';
import type { Sql } from '@/persistence/d1/database';
import { optionalColumn, parse } from '@/persistence/d1/database';
import type { Decoded } from '@/schema';
import { mutableArray, mutableStruct } from '@/schema';

export const deliveryStates = ['pending', 'sending', 'delivered', 'failed'] as const;
export type DeliveryState = (typeof deliveryStates)[number];
export type DeliveryOutcome = { state: 'delivered' } | { state: 'pending' | 'failed'; error: string };
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
export type DeliveryRow = Decoded<typeof delivery>;
export type ClaimedDelivery = Decoded<typeof claimed>;

export class NotificationDeliveries {
	constructor(private readonly sql: Sql) {}

	recent(): Effect.Effect<DeliveryRow[], DomainError> {
		return this.sql.all('SELECT * FROM notification_deliveries ORDER BY updated_at DESC LIMIT 50').pipe(
			Effect.flatMap(rows => parse(mutableArray(delivery), rows)),
		);
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
