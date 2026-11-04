import { addWatch, removeManualWatch } from '@/automation/package-watch';
import { routes } from '@/contract/routes';
import { admin } from '@/server/handlers/kit';

export const notificationEndpoints = {
	notificationsList: admin(routes.notificationsList, async (_, { service }) => {
		const notifications = service.notifications();
		return {
			destinations: await notifications.destinations(),
			subscriptions: await notifications.subscriptions(),
			deliveries: await notifications.recent(),
		};
	}),
	notificationsSave: admin(
		routes.notificationsSave,
		async (input, { service, actor }) => ({
			id: await service.notifications().saveDestination(input.destination, actor),
		}),
	),
	notificationsRemove: admin(routes.notificationsRemove, async (input, { service, actor }) => {
		await service.notifications().removeDestination(input.id, actor);
		return { ok: true };
	}),
	packagesAdd: admin(routes.packagesAdd, async (input, { service, actor }) => {
		await addWatch(service.store, service.notifications(), input.registry, input.name, true);
		await service.store.audit(actor, 'package.watch', `${input.registry}:${input.name}`);
		return { ok: true };
	}),
	packagesRemove: admin(routes.packagesRemove, async (input, { service, actor }) => {
		await removeManualWatch(service.store, input.registry, input.name);
		await service.store.audit(actor, 'package.unwatch', `${input.registry}:${input.name}`);
		return { ok: true };
	}),
	packagesSubscription: admin(routes.packagesSubscription, async (input, { service, actor }) => {
		await service.notifications().setSubscription(input, input.subscribed, actor);
		return { ok: true };
	}),
} as const;
