import { Effect } from 'effect';
import { z } from 'zod';
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

export const deliveryStates = ['pending', 'delivered', 'failed'] as const;
export type DeliveryState = (typeof deliveryStates)[number];
const maximumAttempts = 5;

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
export interface NotificationDelivery {
	id: string;
	eventId: string;
	destinationId: string;
	payload: VersionChangedPayload;
	state: DeliveryState;
	attempts: number;
	error?: string;
	updatedAt: number;
}

const destinationRow = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(notificationKinds),
	credential: z.string(),
	subscribe_new: z.number(),
	enabled: z.number(),
	created_at: z.number(),
});
const subscriptionRow = z.object({
	destination_id: z.string(),
	registry: z.enum(watchedRegistries),
	name: z.string(),
});
const payloadSchema: z.ZodType<VersionChangedPayload> = z.object({
	id: z.string(),
	type: z.literal('package.version.changed'),
	package: z.object({ registry: z.enum(watchedRegistries), name: z.string() }),
	version: z.object({ previous: z.string().nullable(), current: z.string() }),
	url: z.string(),
});
const deliveryRow = z.object({
	id: z.string(),
	event_id: z.string(),
	destination_id: z.string(),
	document: z.string(),
	state: z.enum(deliveryStates),
	attempts: z.number(),
	error: z.string().nullable(),
	updated_at: z.number(),
});

type Outcome = { state: DeliveryState; error?: string };

function destination(row: z.infer<typeof destinationRow>): NotificationDestination {
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
	constructor(
		private store: Store,
		private vault: () => Vault,
		private request: Fetcher = fetch,
	) {
		this.sql = sql(store.db);
	}
	destinations(): Effect.Effect<NotificationDestination[], DomainError> {
		return this.sql.all('SELECT * FROM notification_destinations ORDER BY name, id').pipe(
			Effect.flatMap(rows => parse(z.array(destinationRow), rows)),
			Effect.map(rows => rows.map(destination)),
		);
	}
	subscriptions(): Effect.Effect<NotificationSubscription[], DomainError> {
		return this.sql.all('SELECT destination_id, registry, name FROM notification_subscriptions ORDER BY registry, name')
			.pipe(
				Effect.flatMap(rows => parse(z.array(subscriptionRow), rows)),
				Effect.map(rows =>
					rows.map(row => ({ destinationId: row.destination_id, registry: row.registry, name: row.name }))
				),
			);
	}
	recent(): Effect.Effect<NotificationDelivery[], DomainError> {
		return this.sql.all('SELECT * FROM notification_deliveries ORDER BY updated_at DESC LIMIT 50').pipe(
			Effect.flatMap(rows =>
				fromSync(() =>
					z.array(deliveryRow).parse(rows).map(row => ({
						id: row.id,
						eventId: row.event_id,
						destinationId: row.destination_id,
						payload: payloadSchema.parse(JSON.parse(row.document)),
						state: row.state,
						attempts: row.attempts,
						...(row.error === null ? {} : { error: row.error }),
						updatedAt: row.updated_at,
					}))
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
				Date.now(),
			);
			yield* this.store.audit(actor, 'notification.save', id);
			return id;
		});
	}
	removeDestination(id: string, actor: string): Effect.Effect<void, DomainError> {
		return this.sql.batch([
			this.sql.statement('DELETE FROM notification_subscriptions WHERE destination_id=?', id),
			this.sql.statement(
				"UPDATE notification_deliveries SET state='failed', error='Destination removed', updated_at=? WHERE destination_id=? AND state='pending'",
				Date.now(),
				id,
			),
			this.sql.statement('DELETE FROM notification_destinations WHERE id=?', id),
		]).pipe(Effect.andThen(this.store.audit(actor, 'notification.remove', id)));
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
		return this.sql.run(
			"INSERT OR IGNORE INTO notification_deliveries (id, event_id, destination_id, document, state, attempts, updated_at) SELECT ? || ':' || d.id, ?, d.id, ?, 'pending', 0, ? FROM notification_destinations d JOIN notification_subscriptions s ON s.destination_id = d.id WHERE d.enabled=1 AND s.registry=? AND s.name=?",
			payload.id,
			payload.id,
			JSON.stringify(payload),
			Date.now(),
			payload.package.registry,
			payload.package.name,
		).pipe(Effect.asVoid);
	}
	deliver(): Effect.Effect<void, DomainError> {
		return Effect.gen({ self: this }, function*() {
			const rows = yield* this.sql.all(
				"SELECT * FROM notification_deliveries WHERE state='pending' ORDER BY updated_at LIMIT 50",
			);
			const destinations = new Map((yield* this.destinations()).map(entry => [entry.id, entry]));
			for (const row of yield* parse(z.array(deliveryRow), rows)) {
				const attempts = row.attempts + 1;
				const payload = yield* fromSync(() => payloadSchema.parse(JSON.parse(row.document)));
				const outcome = yield* this.send(destinations.get(row.destination_id), payload);
				const state = outcome.state === 'pending' && attempts >= maximumAttempts ? 'failed' : outcome.state;
				yield* this.sql.run(
					'UPDATE notification_deliveries SET state=?, attempts=?, error=?, updated_at=? WHERE id=?',
					state,
					attempts,
					outcome.error ?? null,
					Date.now(),
					row.id,
				);
			}
		});
	}
	private send(
		destination: NotificationDestination | undefined,
		payload: VersionChangedPayload,
	): Effect.Effect<Outcome> {
		return Effect.gen({ self: this }, function*() {
			if (!destination?.enabled) return { state: 'failed', error: 'Destination unavailable' };
			const secret = yield* this.vault().reveal(destination.credential, `notify:${destination.id}`).pipe(
				Effect.map(credential => credential.value),
				Effect.catchCause(() => Effect.undefined),
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
			const response = yield* fromPromise(() =>
				request(url, {
					method: 'POST',
					redirect: 'manual',
					signal: AbortSignal.timeout(10_000),
					headers: {
						'Content-Type': 'application/json',
						'Idempotency-Key': payload.id,
						'User-Agent': 'beepboop notifications',
					},
					body: JSON.stringify(destination.kind === 'slack' ? slackMessage(payload) : payload),
				})
			).pipe(Effect.catchCause(() => Effect.undefined));
			if (!response) return { state: 'pending', error: 'Request failed' };
			yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
			if (response.ok) return { state: 'delivered' };
			return { state: retryable(response.status) ? 'pending' : 'failed', error: `HTTP ${response.status}` };
		});
	}
}
