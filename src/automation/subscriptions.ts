import { matchesPublication } from '@/automation/package-identity';
import type { AutomationEvent, Subscription } from '@/automation/types';

export function matchesSubscription(subscription: Subscription, event: AutomationEvent): boolean {
	return subscription.source === event.source && subscription.event === event.event
		&& (!subscription.workflow || subscription.workflow === event.workflow)
		&& (!subscription.sourceStream || subscription.sourceStream === event.release?.stream)
		&& (!subscription.sourceGroup || subscription.sourceGroup === event.release?.group)
		&& (!subscription.publication
			|| Boolean(
				event.release?.publications.some(publication =>
					matchesPublication(subscription.publication ?? '', publication) && publication.outcome === 'succeeded'
				),
			));
}
