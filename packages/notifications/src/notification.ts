import { Schema } from 'effect';
import { watchedPackageHref } from '@/contract/links';
import type { NotificationKind, WatchedRegistry } from '@/domain/catalog.ts';
import { watchedRegistries } from '@/domain/catalog.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

export const deliveryStates = ['pending', 'sending', 'delivered', 'failed'] as const;
export type DeliveryState = (typeof deliveryStates)[number];
export type DeliveryOutcome = { state: 'delivered' } | { state: 'pending' | 'failed'; error: string };

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
export interface DeliveryFields {
	id: string;
	eventId: string;
	destinationId: string;
	payload: VersionChangedPayload | null;
	payloadError?: string;
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

export const versionChangedPayload: Schema.Codec<VersionChangedPayload, unknown> = mutableStruct({
	id: Schema.String,
	type: Schema.Literal('package.version.changed'),
	package: mutableStruct({ registry: Schema.Literals(watchedRegistries), name: Schema.String }),
	version: mutableStruct({ previous: Schema.NullOr(Schema.String), current: Schema.String }),
	url: Schema.String,
});

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
