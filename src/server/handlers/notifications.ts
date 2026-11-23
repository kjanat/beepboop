import { routes } from '@/contract/routes';
import {
	listNotifications,
	removeDestination,
	saveDestination,
	setSubscription,
} from '@/notifications/http/notifications.ts';
import { unwatchPackage, watchPackage } from '@/notifications/http/packages.ts';
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
	packagesAdd: admin(
		routes.packagesAdd,
		(input, { service, actor }) => watchPackage(service.store.db, service.notifications(), input, actor),
	),
	packagesRemove: admin(
		routes.packagesRemove,
		(input, { service, actor }) => unwatchPackage(service.store.db, input, actor),
	),
	packagesSubscription: admin(
		routes.packagesSubscription,
		(input, { service, actor }) => setSubscription(service.notifications(), input, actor),
	),
} as const;
