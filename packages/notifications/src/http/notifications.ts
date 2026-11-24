import { Effect } from 'effect';
import type { DestinationInput } from '@/notifications/contract.ts';
import type { Notifications } from '@/notifications/delivery.ts';
import type { NotificationSubscription } from '@/notifications/notification.ts';

export function listNotifications(notifications: Notifications) {
	return Effect.all({
		destinations: notifications.destinations(),
		subscriptions: notifications.subscriptions(),
		deliveries: notifications.recent(),
	});
}

export function saveDestination(notifications: Notifications, destination: DestinationInput, actor: string) {
	return notifications.saveDestination(destination, actor).pipe(Effect.map(id => ({ id })));
}

export function removeDestination(notifications: Notifications, id: string, actor: string) {
	return notifications.removeDestination(id, actor).pipe(Effect.as({ ok: true }));
}

export function setSubscription(
	notifications: Notifications,
	input: NotificationSubscription & { readonly subscribed: boolean },
	actor: string,
) {
	return notifications.setSubscription(input, input.subscribed, actor).pipe(Effect.as({ ok: true }));
}
