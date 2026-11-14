import type { ViewOf } from '@/server/loaders.ts';

export function notificationsPage(data: ViewOf<'notifications'>) {
	const counts = new Map<string, number>();
	for (const subscription of data.subscriptions) {
		counts.set(subscription.destinationId, (counts.get(subscription.destinationId) ?? 0) + 1);
	}
	const names = new Map(data.destinations.map(destination => [destination.id, destination.name]));
	return {
		destinations: data.destinations.map(destination => ({
			...destination,
			packages: counts.get(destination.id) ?? 0,
		})),
		deliveries: data.notifications.map(delivery => ({
			...delivery,
			destination: names.get(delivery.destinationId) ?? 'Removed destination',
		})),
	};
}
