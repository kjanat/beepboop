import { z } from 'zod';
import type { Fetcher } from '@/automation/managers/registry';
import type { Store } from '@/automation/store';
import type { Vault } from '@/automation/vault';
import { type NotificationKind, notificationKinds, type WatchedRegistry, watchedRegistries } from '@/contract/catalog';
import { precondition } from '@/contract/errors';
import { watchedPackageHref } from '@/contract/links';
import type { DestinationInput } from '@/contract/notifications';

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
	constructor(
		private store: Store,
		private vault: () => Vault,
		private request: Fetcher = fetch,
	) {}
	async destinations(): Promise<NotificationDestination[]> {
		const rows = await this.store.db.prepare('SELECT * FROM notification_destinations ORDER BY name, id').all();
		return z.array(destinationRow).parse(rows.results).map(destination);
	}
	async subscriptions(): Promise<NotificationSubscription[]> {
		const rows = await this.store.db
			.prepare('SELECT destination_id, registry, name FROM notification_subscriptions ORDER BY registry, name')
			.all();
		return z.array(subscriptionRow).parse(rows.results).map(row => ({
			destinationId: row.destination_id,
			registry: row.registry,
			name: row.name,
		}));
	}
	async recent(): Promise<NotificationDelivery[]> {
		const rows = await this.store.db
			.prepare('SELECT * FROM notification_deliveries ORDER BY updated_at DESC LIMIT 50')
			.all();
		return z.array(deliveryRow).parse(rows.results).map(row => ({
			id: row.id,
			eventId: row.event_id,
			destinationId: row.destination_id,
			payload: payloadSchema.parse(JSON.parse(row.document)),
			state: row.state,
			attempts: row.attempts,
			...(row.error === null ? {} : { error: row.error }),
			updatedAt: row.updated_at,
		}));
	}
	async checkDestination(input: DestinationInput): Promise<void> {
		const saved = await this.store.db.prepare('SELECT 1 FROM credentials WHERE alias=? AND active=1').bind(
			input.credential,
		).first();
		if (!saved) throw precondition('Store the webhook URL as a secret before using it');
	}
	async saveDestination(input: DestinationInput, actor: string): Promise<string> {
		await this.checkDestination(input);
		const id = input.id ?? crypto.randomUUID();
		await this.store.db
			.prepare(
				'INSERT INTO notification_destinations (id, name, kind, credential, subscribe_new, enabled, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, credential=excluded.credential, subscribe_new=excluded.subscribe_new, enabled=excluded.enabled',
			)
			.bind(id, input.name, input.kind, input.credential, Number(input.subscribeNew), Number(input.enabled), Date.now())
			.run();
		await this.store.audit(actor, 'notification.save', id);
		return id;
	}
	async removeDestination(id: string, actor: string): Promise<void> {
		await this.store.db.batch([
			this.store.db.prepare('DELETE FROM notification_subscriptions WHERE destination_id=?').bind(id),
			this.store.db.prepare(
				"UPDATE notification_deliveries SET state='failed', error='Destination removed', updated_at=? WHERE destination_id=? AND state='pending'",
			).bind(Date.now(), id),
			this.store.db.prepare('DELETE FROM notification_destinations WHERE id=?').bind(id),
		]);
		await this.store.audit(actor, 'notification.remove', id);
	}
	async setSubscription(subscription: NotificationSubscription, subscribed: boolean, actor: string): Promise<void> {
		await this.store.db
			.prepare(
				subscribed
					? 'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE id=?'
					: 'DELETE FROM notification_subscriptions WHERE registry=? AND name=? AND destination_id=?',
			)
			.bind(subscription.registry, subscription.name, subscription.destinationId)
			.run();
		await this.store.audit(
			actor,
			subscribed ? 'notification.subscribe' : 'notification.unsubscribe',
			`${subscription.registry}:${subscription.name} ${subscription.destinationId}`,
		);
	}
	async subscribeNew(registry: WatchedRegistry, name: string): Promise<void> {
		await this.store.db
			.prepare(
				'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE enabled=1 AND subscribe_new=1',
			)
			.bind(registry, name)
			.run();
	}
	async stage(payload: VersionChangedPayload): Promise<void> {
		await this.store.db
			.prepare(
				"INSERT OR IGNORE INTO notification_deliveries (id, event_id, destination_id, document, state, attempts, updated_at) SELECT ? || ':' || d.id, ?, d.id, ?, 'pending', 0, ? FROM notification_destinations d JOIN notification_subscriptions s ON s.destination_id = d.id WHERE d.enabled=1 AND s.registry=? AND s.name=?",
			)
			.bind(payload.id, payload.id, JSON.stringify(payload), Date.now(), payload.package.registry, payload.package.name)
			.run();
	}
	async deliver(): Promise<void> {
		const rows = await this.store.db
			.prepare("SELECT * FROM notification_deliveries WHERE state='pending' ORDER BY updated_at LIMIT 50")
			.all();
		const destinations = new Map((await this.destinations()).map(entry => [entry.id, entry]));
		for (const row of z.array(deliveryRow).parse(rows.results)) {
			const attempts = row.attempts + 1;
			const outcome = await this.send(
				destinations.get(row.destination_id),
				payloadSchema.parse(JSON.parse(row.document)),
			);
			const state = outcome.state === 'pending' && attempts >= maximumAttempts ? 'failed' : outcome.state;
			await this.store.db
				.prepare('UPDATE notification_deliveries SET state=?, attempts=?, error=?, updated_at=? WHERE id=?')
				.bind(state, attempts, outcome.error ?? null, Date.now(), row.id)
				.run();
		}
	}
	private async send(
		destination: NotificationDestination | undefined,
		payload: VersionChangedPayload,
	): Promise<Outcome> {
		if (!destination?.enabled) return { state: 'failed', error: 'Destination unavailable' };
		let secret: string;
		try {
			secret = (await this.vault().reveal(destination.credential, `notify:${destination.id}`)).value;
		} catch {
			return { state: 'pending', error: 'Webhook secret unavailable' };
		}
		const url = target(destination.kind, secret);
		if (!url) {
			return {
				state: 'failed',
				error: destination.kind === 'slack' ? 'Secret is not a Slack webhook URL' : 'Secret is not an HTTPS URL',
			};
		}
		let response: Response;
		try {
			const request = this.request;
			response = await request(url, {
				method: 'POST',
				redirect: 'manual',
				signal: AbortSignal.timeout(10_000),
				headers: {
					'Content-Type': 'application/json',
					'Idempotency-Key': payload.id,
					'User-Agent': 'beepboop notifications',
				},
				body: JSON.stringify(destination.kind === 'slack' ? slackMessage(payload) : payload),
			});
		} catch {
			return { state: 'pending', error: 'Request failed' };
		}
		await response.body?.cancel().catch(() => undefined);
		if (response.ok) return { state: 'delivered' };
		return { state: retryable(response.status) ? 'pending' : 'failed', error: `HTTP ${response.status}` };
	}
}
