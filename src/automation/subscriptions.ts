import type { AutomationEvent, Subscription } from './types.ts';

export function matchesSubscription(subscription: Subscription, event: AutomationEvent): boolean {
	return subscription.source === event.source && subscription.event === event.event
		&& (!subscription.workflow || subscription.workflow === event.workflow)
		&& (!subscription.sourceStream || subscription.sourceStream === event.release?.stream)
		&& (!subscription.sourceGroup || subscription.sourceGroup === event.release?.group)
		&& (!subscription.publication
			|| Boolean(
				event.release?.publications.some(publication =>
					publication.id === subscription.publication && publication.outcome === 'succeeded'
				),
			));
}
