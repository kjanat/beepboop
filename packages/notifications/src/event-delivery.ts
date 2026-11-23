import { Effect } from 'effect';
import { createExecution } from '@/automation/execution';
import type { AutomationEvent, Execution, SubscriptionDelivery } from '@/automation/types';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import type { ReadyRepository } from '@/domain/repository';
import { readiness, requireReady } from '@/domain/repository';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { ReleaseEvents } from '@/notifications/adapters/d1/events.ts';
import { matchesSubscription } from '@/notifications/subscriptions.ts';
import { executionId } from '@/persistence/identity-keys';

export interface EventDelivery {
	readonly events: ReleaseEvents;
	readonly repositories: Effect.Effect<RepositoryRecord[], DomainError>;
	readonly repository: (id: number) => Effect.Effect<RepositoryRecord | undefined, DomainError>;
	readonly packagePublished: (
		repositoryId: number,
		registry: string,
		name: string,
		version: string,
	) => Effect.Effect<void, DomainError>;
	readonly openIssue: (
		repository: ReadyRepository,
		deliveryId: string,
		issue: { title: string; body: string },
	) => Effect.Effect<void, DomainError>;
	readonly enqueue: (repository: ReadyRepository, execution: Execution) => Effect.Effect<void, DomainError>;
}

export const deliverPending = Effect.fnUntraced(function*(delivery: EventDelivery) {
	for (const pending of yield* delivery.events.pending()) {
		const delivered = yield* Effect.gen(function*() {
			const repository = yield* delivery.repository(pending.repositoryId);
			if (!repository) return yield* precondition('Destination unavailable');
			const ready = yield* requireReady(repository);
			if ('issue' in pending) {
				yield* delivery.openIssue(ready, pending.id, pending.issue);
			} else yield* delivery.enqueue(ready, pending.execution);
		}).pipe(Effect.as(true), Effect.orElseSucceed(() => false));
		yield* delivery.events.settle(pending.id, delivered);
	}
});

export const deliverEvent = Effect.fnUntraced(function*(delivery: EventDelivery, event: AutomationEvent) {
	if (
		event.event === 'release'
		&& (!event.release || event.release.repository.name !== event.source
			|| event.release.version !== event.version)
	) {
		return yield* precondition('Release event requires its upstream identity');
	}
	const deliveries: SubscriptionDelivery[] = [];
	const separator = event.source.indexOf(':');
	const published = event.event === 'package.version.changed' && event.version && separator > 0
		? {
			registry: event.source.slice(0, separator),
			name: event.source.slice(separator + 1),
			version: event.version,
		}
		: undefined;
	for (const stored of yield* delivery.repositories) {
		const state = readiness(stored);
		if (state.kind !== 'ready') continue;
		const repository = state.repository;
		if (
			published
			&& repository.inventory.packages.some(pkg => pkg.manager === published.registry && pkg.name === published.name)
		) {
			yield* delivery.packagePublished(repository.id, published.registry, published.name, published.version);
		}
		for (const subscription of repository.configuration.subscriptions) {
			if (!matchesSubscription(subscription, event)) continue;
			if ('issue' in subscription) {
				if (!event.version) continue;
				const id = yield* executionId(repository.id, subscription.id, 'issue', `package:${event.id}`);
				deliveries.push({
					id,
					eventId: event.id,
					repositoryId: repository.id,
					issue: {
						title: subscription.issue.title.replaceAll('{version}', event.version),
						body: subscription.issue.body.replaceAll('{version}', event.version),
					},
				});
				continue;
			}
			const execution = yield* (
				createExecution(repository, {
					stream: subscription.stream,
					operation: subscription.operation,
					eventId: `${subscription.id}:${event.id}`,
					sourceSha: repository.sha,
					version: event.version,
					upstreamRelease: event.release,
				})
			);
			deliveries.push({ id: execution.id, eventId: event.id, repositoryId: repository.id, execution });
		}
	}
	yield* delivery.events.queue(event, deliveries);
	yield* deliverPending(delivery);
});
