import { Effect } from 'effect';
import { addWatch, removeManualWatch } from '@/automation/package-watch';
import { routes } from '@/contract/routes';
import { admin } from '@/server/handlers/kit';

export const notificationEndpoints = {
	notificationsList: admin(routes.notificationsList, (_, { service }) => {
		const notifications = service.notifications();
		return Effect.all({
			destinations: notifications.destinations(),
			subscriptions: notifications.subscriptions(),
			deliveries: notifications.recent(),
		});
	}),
	notificationsSave: admin(
		routes.notificationsSave,
		(input, { service, actor }) =>
			service.notifications().saveDestination(input.destination, actor).pipe(Effect.map(id => ({ id }))),
	),
	notificationsRemove: admin(
		routes.notificationsRemove,
		(input, { service, actor }) =>
			service.notifications().removeDestination(input.id, actor).pipe(Effect.as({ ok: true })),
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
		(input, { service, actor }) =>
			service.notifications().setSubscription(input, input.subscribed, actor).pipe(Effect.as({ ok: true })),
	),
} as const;
