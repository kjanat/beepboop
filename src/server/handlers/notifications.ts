import { Effect } from 'effect';
import { addWatch, removeManualWatch } from '@/automation/package-watch';
import { routes } from '@/contract/routes';
import {
	listNotifications,
	removeDestination,
	saveDestination,
	setSubscription,
} from '@/notifications/http/notifications.ts';
import { admin } from '@/server/handlers/kit';

export const notificationEndpoints = {
	notificationsList: admin(routes.notificationsList, (_, { service }) => listNotifications(service.notifications())),
	notificationsSave: admin(
		routes.notificationsSave,
		(input, { service, actor }) => saveDestination(service.notifications(), input.destination, actor),
	),
	notificationsRemove: admin(
		routes.notificationsRemove,
		(input, { service, actor }) => removeDestination(service.notifications(), input.id, actor),
	),
	packagesAdd: admin(routes.packagesAdd, (input, { service, actor }) =>
		Effect.gen(function*() {
			yield* addWatch(service.store, service.notifications(), input.registry, input.name, true);
			yield* service.store.audit(actor, 'package.watch', `${input.registry}:${input.name}`);
			return { ok: true };
		})),
	packagesRemove: admin(routes.packagesRemove, (input, { service, actor }) =>
		Effect.gen(function*() {
			yield* removeManualWatch(service.store, input.registry, input.name);
			yield* service.store.audit(actor, 'package.unwatch', `${input.registry}:${input.name}`);
			return { ok: true };
		})),
	packagesSubscription: admin(
		routes.packagesSubscription,
		(input, { service, actor }) => setSubscription(service.notifications(), input, actor),
	),
} as const;
