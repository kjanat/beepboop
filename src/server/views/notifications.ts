import type { ViewOf } from '@/server/loaders.ts';

export function notificationsPage(data: ViewOf<'notifications'>) {
	const names = new Map(data.destinations.map(destination => [destination.id, destination.name]));
	return {
		destinations: data.destinations.map(destination => ({
			...destination,
			packages: data.subscriptions.filter(s => s.destinationId === destination.id).length,
		})),
		deliveries: data.notifications.map(delivery => ({
			...delivery,
			destination: names.get(delivery.destinationId) ?? 'Removed destination',
		})),
	};
}
