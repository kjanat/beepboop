import { Clock, Effect, Result } from 'effect';
import type { Vault } from '@/credentials/vault.ts';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import { NotificationDeliveries } from '@/notifications/adapters/d1/deliveries.ts';
import { NotificationDestinations } from '@/notifications/adapters/d1/destinations.ts';
import type { DestinationInput } from '@/notifications/contract.ts';
import type {
	DeliveryFields,
	NotificationDelivery,
	NotificationDestination,
	NotificationSubscription,
	VersionChangedPayload,
} from '@/notifications/notification.ts';
import { versionChangedPayload } from '@/notifications/notification.ts';
import type { Sender } from '@/notifications/send.ts';
import { send } from '@/notifications/send.ts';
import { AuditStore } from '@/persistence/d1/audit';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';

export class Notifications {
	private readonly audit: AuditStore;
	private readonly destinationStore: NotificationDestinations;
	private readonly deliveries: NotificationDeliveries;
	private readonly sender: Sender;
	constructor(db: SqlDatabase | Sql, vault: () => Pick<Vault, 'reveal'>, request: Fetcher = platformFetch) {
		const statements = sql(db);
		this.audit = new AuditStore(statements);
		this.destinationStore = new NotificationDestinations(statements);
		this.deliveries = new NotificationDeliveries(statements);
		this.sender = { vault, request, deliveries: this.deliveries };
	}
	destinations(): Effect.Effect<NotificationDestination[], DomainError> {
		return this.destinationStore.list();
	}
	subscriptions(): Effect.Effect<NotificationSubscription[], DomainError> {
		return this.destinationStore.subscriptions();
	}
	recent(): Effect.Effect<NotificationDelivery[], DomainError> {
		return this.deliveries.recent().pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					rows.map((row): NotificationDelivery => {
						const decoded = Result.try(() => decodeSync(versionChangedPayload, JSON.parse(row.document)));
						const fields: DeliveryFields = {
							id: row.id,
							eventId: row.event_id,
							destinationId: row.destination_id,
							payload: Result.isSuccess(decoded) ? decoded.success : null,
							...(Result.isFailure(decoded) ? { payloadError: 'Invalid notification payload' } : {}),
							attempts: row.attempts,
							updatedAt: row.updated_at,
						};
						if (row.state === 'delivered') return { ...fields, state: row.state };
						if (row.state === 'failed') return { ...fields, state: row.state, error: row.error };
						return { ...fields, state: row.state, ...(row.error === null ? {} : { error: row.error }) };
					})
				)
			),
		);
	}
	saveDestination(input: DestinationInput, actor: string): Effect.Effect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			yield* this.destinationStore.credentialStored(input.credential).pipe(
				Effect.filterOrFail(
					saved => saved,
					() => precondition('Store the webhook URL as a secret before using it'),
				),
			);
			const id = input.id ?? crypto.randomUUID();
			yield* this.destinationStore.save(id, input, clock.currentTimeMillisUnsafe());
			yield* this.audit.record(actor, 'notification.save', id);
			return id;
		});
	}
	removeDestination(id: string, actor: string): Effect.Effect<void, DomainError> {
		return this.destinationStore.remove(id).pipe(Effect.andThen(this.audit.record(actor, 'notification.remove', id)));
	}
	setSubscription(
		subscription: NotificationSubscription,
		subscribed: boolean,
		actor: string,
	): Effect.Effect<void, DomainError> {
		return this.destinationStore.setSubscription(subscription, subscribed).pipe(Effect.andThen(this.audit.record(
			actor,
			subscribed ? 'notification.subscribe' : 'notification.unsubscribe',
			`${subscription.registry}:${subscription.name} ${subscription.destinationId}`,
		)));
	}
	subscribeNew(registry: WatchedRegistry, name: string): Effect.Effect<void, DomainError> {
		return this.destinationStore.subscribeNew(registry, name);
	}
	stage(payload: VersionChangedPayload): Effect.Effect<void, DomainError> {
		return this.deliveries.enqueue(payload);
	}
	deliver(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const ids = yield* this.deliveries.available();
			for (const id of ids) {
				const claim = yield* this.deliveries.claim(id);
				if (!claim) continue;
				const current = yield* this.destinationStore.current(claim.destination_id);
				const outcome = yield* send(this.sender, claim, current);
				yield* this.deliveries.settle(claim, outcome);
			}
		});
	}
}
