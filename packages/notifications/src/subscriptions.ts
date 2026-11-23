import type { Subscription } from '@/domain/configuration/schema.ts';
import { matchesPublication } from '@/domain/package-identity.ts';
import type { AutomationEvent } from '@/release/domain/execution/types.ts';

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
