import { Clock, Effect, Schema } from 'effect';
import type { Fetcher } from '@/automation/managers/registry';
import type { Store } from '@/automation/store';
import type { Vault } from '@/automation/vault';
import type { NotificationKind, WatchedRegistry } from '@/contract/catalog';
import { notificationKinds, watchedRegistries } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { watchedPackageHref } from '@/contract/links';
import type { DestinationInput } from '@/contract/notifications';
import { fromPromise, fromSync } from '@/failure';
import type { Sql } from '@/persistence/d1/database';
import { parse, sql } from '@/persistence/d1/database';
import type { ClaimedDelivery, DeliveryOutcome } from '@/persistence/d1/notification-deliveries';
import { NotificationDeliveries } from '@/persistence/d1/notification-deliveries';
import type { Decoded } from '@/schema';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

export type { DeliveryState } from '@/persistence/d1/notification-deliveries';
export { deliveryStates } from '@/persistence/d1/notification-deliveries';

export interface NotificationDestination {
	id: string;
	name: string;
	kind: NotificationKind;
	credential: string;
	subscribeNew: boolean;
	enabled: boolean;
	createdAt: number;
}
export interface NotificationSubscription {
	destinationId: string;
	registry: WatchedRegistry;
	name: string;
}
export interface VersionChangedPayload {
	id: string;
	type: 'package.version.changed';
	package: { registry: WatchedRegistry; name: string };
	version: { previous: string | null; current: string };
	url: string;
}
interface DeliveryFields {
	id: string;
	eventId: string;
	destinationId: string;
	payload: VersionChangedPayload;
	attempts: number;
	updatedAt: number;
}

export type NotificationDelivery =
	& DeliveryFields
	& (
		| { state: 'pending' | 'sending'; error?: string }
		| { state: 'delivered'; error?: never }
		| { state: 'failed'; error: string }
	);

const destinationRow = mutableStruct({
	id: Schema.String,
	name: Schema.String,
	kind: Schema.Literals(notificationKinds),
	credential: Schema.String,
	subscribe_new: Schema.Finite,
	enabled: Schema.Finite,
	created_at: Schema.Finite,
});
const subscriptionRow = mutableStruct({
	destination_id: Schema.String,
	registry: Schema.Literals(watchedRegistries),
	name: Schema.String,
});
const payloadSchema: Schema.Codec<VersionChangedPayload, unknown> = mutableStruct({
	id: Schema.String,
	type: Schema.Literal('package.version.changed'),
	package: mutableStruct({ registry: Schema.Literals(watchedRegistries), name: Schema.String }),
	version: mutableStruct({ previous: Schema.NullOr(Schema.String), current: Schema.String }),
	url: Schema.String,
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

export function versionChanged(
	id: string,
	registry: WatchedRegistry,
	name: string,
	previous: string | null,
	current: string,
): VersionChangedPayload {
	return {
		id,
		type: 'package.version.changed',
		package: { registry, name },
		version: { previous, current },
		url: watchedPackageHref(registry, name),
	};
}

function escapeSlack(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function slackUrl(value: string): string {
	return new URL(value).toString().replaceAll('&', '&amp;').replaceAll('|', '%7C').replaceAll('<', '%3C')
		.replaceAll('>', '%3E');
}

export function slackMessage(payload: VersionChangedPayload) {
	const name = escapeSlack(payload.package.name);
	const registry = escapeSlack(payload.package.registry);
	const current = escapeSlack(payload.version.current);
	const previous = payload.version.previous === null ? 'Unpublished' : escapeSlack(payload.version.previous);
	const mrkdwn = (text: string) => ({ type: 'mrkdwn', text, verbatim: true });
	return {
		text: payload.version.previous === null
			? `Beepboop: ${registry} package ${name} first released at ${current}.`
			: `Beepboop: ${registry} package ${name} changed from ${previous} to ${current}.`,
		unfurl_links: false,
		blocks: [
			{
				type: 'header',
				text: {
					type: 'plain_text',
					text: payload.version.previous === null ? 'Package first released' : 'Package version changed',
					emoji: true,
				},
			},
			{
				type: 'section',
				fields: [
					mrkdwn(`*Package*\n${name}`),
					mrkdwn(`*Registry*\n${registry}`),
					mrkdwn(`*Previous version*\n${previous}`),
					mrkdwn(`*Current version*\n${current}`),
				],
			},
			{ type: 'section', text: mrkdwn(`<${slackUrl(payload.url)}|View package>`) },
			{ type: 'context', elements: [mrkdwn(`Event ID: ${escapeSlack(payload.id)}`)] },
		],
	};
}

function target(kind: NotificationKind, value: string): URL | undefined {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.username || url.password) return undefined;
		if (kind === 'slack' && !['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname)) return undefined;
		return url;
	} catch {
		return undefined;
	}
}

function retryable(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class Notifications {
	private readonly sql: Sql;
	private readonly deliveries: NotificationDeliveries;
	constructor(
		private store: Store,
		private vault: () => Pick<Vault, 'reveal'>,
		private request: Fetcher = fetch,
	) {
		this.sql = sql(store.db);
		this.deliveries = new NotificationDeliveries(this.sql);
	}
	destinations(): Effect.Effect<NotificationDestination[], DomainError> {
		return this.sql.all('SELECT * FROM notification_destinations ORDER BY name, id').pipe(
			Effect.flatMap(rows => parse(mutableArray(destinationRow), rows)),
			Effect.map(rows => rows.map(destination)),
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
	recent(): Effect.Effect<NotificationDelivery[], DomainError> {
		return this.deliveries.recent().pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					rows.map((row): NotificationDelivery => {
						const fields: DeliveryFields = {
							id: row.id,
							eventId: row.event_id,
							destinationId: row.destination_id,
							payload: decodeSync(payloadSchema, JSON.parse(row.document)),
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
	private checkDestination(input: DestinationInput): Effect.Effect<void, DomainError> {
		return this.sql.first('SELECT 1 FROM credentials WHERE alias=? AND active=1', input.credential).pipe(
			Effect.filterOrFail(
				saved => !!saved,
				() => precondition('Store the webhook URL as a secret before using it'),
			),
			Effect.asVoid,
		);
	}
	saveDestination(input: DestinationInput, actor: string): Effect.Effect<string, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			yield* this.checkDestination(input);
			const id = input.id ?? crypto.randomUUID();
			yield* this.sql.run(
				'INSERT INTO notification_destinations (id, name, kind, credential, subscribe_new, enabled, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, credential=excluded.credential, subscribe_new=excluded.subscribe_new, enabled=excluded.enabled',
				id,
				input.name,
				input.kind,
				input.credential,
				Number(input.subscribeNew),
				Number(input.enabled),
				clock.currentTimeMillisUnsafe(),
			);
			yield* this.store.audit(actor, 'notification.save', id);
			return id;
		});
	}
	removeDestination(id: string, actor: string): Effect.Effect<void, DomainError> {
		return Effect.clockWith(clock => {
			return this.sql.batch([
				this.sql.statement('DELETE FROM notification_subscriptions WHERE destination_id=?', id),
				this.sql.statement(
					"UPDATE notification_deliveries SET state='failed', error='Destination removed', lease=NULL, lease_until=NULL, updated_at=? WHERE destination_id=? AND state IN ('pending','sending')",
					clock.currentTimeMillisUnsafe(),
					id,
				),
				this.sql.statement('DELETE FROM notification_destinations WHERE id=?', id),
			]).pipe(Effect.andThen(this.store.audit(actor, 'notification.remove', id)));
		});
	}
	setSubscription(
		subscription: NotificationSubscription,
		subscribed: boolean,
		actor: string,
	): Effect.Effect<void, DomainError> {
		return this.sql.run(
			subscribed
				? 'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE id=?'
				: 'DELETE FROM notification_subscriptions WHERE registry=? AND name=? AND destination_id=?',
			subscription.registry,
			subscription.name,
			subscription.destinationId,
		).pipe(Effect.andThen(this.store.audit(
			actor,
			subscribed ? 'notification.subscribe' : 'notification.unsubscribe',
			`${subscription.registry}:${subscription.name} ${subscription.destinationId}`,
		)));
	}
	subscribeNew(registry: WatchedRegistry, name: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE enabled=1 AND subscribe_new=1',
			registry,
			name,
		).pipe(Effect.asVoid);
	}
	stage(payload: VersionChangedPayload): Effect.Effect<void, DomainError> {
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
	deliver(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const ids = yield* this.deliveries.available();
			const destinations = new Map((yield* this.destinations()).map(entry => [entry.id, entry]));
			for (const id of ids) {
				const claim = yield* this.deliveries.claim(id);
				if (!claim) continue;
				const outcome = yield* this.send(claim, destinations.get(claim.destination_id));
				yield* this.deliveries.settle(claim, outcome);
			}
		});
	}
	private send(
		claim: ClaimedDelivery,
		destination: NotificationDestination | undefined,
	): Effect.Effect<DeliveryOutcome> {
		return Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;
			const payload = yield* fromSync(() => decodeSync(payloadSchema, JSON.parse(claim.document))).pipe(
				Effect.orElseSucceed(() => undefined),
			);
			if (!payload) return { state: 'failed', error: 'Invalid notification payload' };
			if (!destination?.enabled) return { state: 'failed', error: 'Destination unavailable' };
			const secret = yield* this.vault().reveal(destination.credential, `notify:${destination.id}`).pipe(
				Effect.map(credential => credential.value),
				Effect.catch(() => Effect.undefined),
			);
			if (secret === undefined) return { state: 'pending', error: 'Webhook secret unavailable' };
			const url = target(destination.kind, secret);
			if (!url) {
				return {
					state: 'failed',
					error: destination.kind === 'slack' ? 'Secret is not a Slack webhook URL' : 'Secret is not an HTTPS URL',
				};
			}
			const request = this.request;
			const remaining = claim.lease_until - clock.currentTimeMillisUnsafe();
			if (remaining <= 0) return { state: 'pending', error: 'Delivery lease expired before sending' };
			const response = yield* fromPromise(signal =>
				request(url, {
					method: 'POST',
					redirect: 'manual',
					signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(10_000, remaining))]),
					headers: {
						'Content-Type': 'application/json',
						'Idempotency-Key': payload.id,
						'User-Agent': 'beepboop notifications',
					},
					body: JSON.stringify(destination.kind === 'slack' ? slackMessage(payload) : payload),
				})
			).pipe(Effect.catch(() => Effect.undefined));
			if (!response) return { state: 'pending', error: 'Request failed' };
			yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
			if (response.ok) return { state: 'delivered' };
			return { state: retryable(response.status) ? 'pending' : 'failed', error: `HTTP ${response.status}` };
		});
	}
}
