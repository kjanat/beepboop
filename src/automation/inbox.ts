import { Clock, Context, Effect, Layer } from 'effect';
import { Automation } from '@/automation/service.ts';
import type { InboxEvent } from '@/github/webhooks.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import type { InboxEntry } from '@/release/adapters/do/keys.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { InboxQueue } from '@/release/services/coordinator/retry-queue.ts';

export class InboxRouter extends Context.Service<InboxRouter, {
	readonly route: (entry: InboxEntry) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/InboxRouter') {
	static readonly layer = Layer.effect(
		InboxRouter,
		Effect.map(
			Automation,
			automation =>
				InboxRouter.of({ route: entry => automation.receive(entry.delivery, entry.repositoryId, entry.event) }),
		),
	);
}

export class Inbox extends Context.Service<Inbox, {
	readonly accept: (delivery: string, repositoryId: number, event: InboxEvent) => Effect.Effect<void, DomainError>;
	readonly drain: (now: number) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/Inbox') {
	static readonly layer = Layer.effect(
		Inbox,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const planner = yield* AlarmPlanner;
			const queue = yield* InboxQueue;
			const router = yield* InboxRouter;
			return Inbox.of({
				accept: Effect.fnUntraced(function*(delivery: string, repositoryId: number, event: InboxEvent) {
					const clock = yield* Clock.Clock;
					if (yield* storage.has(Keys.inbox, delivery)) return;
					const now = clock.currentTimeMillisUnsafe();
					yield* storage.put(Keys.inbox, delivery, { delivery, repositoryId, event, attempts: 0, due: now });
					yield* planner.arm(now);
				}),
				drain: now => queue.drain(now, entry => router.route(entry).pipe(Effect.as(undefined))),
			});
		}),
	);
}
