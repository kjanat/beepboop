import type { ViewOf } from '@/server/loaders.ts';

export function packagesPage(data: ViewOf<'packages'>) {
	return data.packages.map(pkg => ({
		...pkg,
		notifications: data.destinations.map(destination => ({
			destination,
			subscribed: data.subscriptions.some(s =>
				s.destinationId === destination.id && s.registry === pkg.registry && s.name === pkg.name
			),
		})),
	}));
}
