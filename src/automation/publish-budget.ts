import { DurableObject } from 'cloudflare:workers';
import { Clock, Effect, Schema } from 'effect';
import { deferSlot, reserveSlot } from '@/automation/publish-pace';
import type { PublishKind } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { fromPromise, fromSync } from '@/failure';
import { decodeSync } from '@/schema';

const arrival = Schema.optional(Schema.Finite);

export class PublishBudget extends DurableObject<unknown> {
	private theoretical(kind: PublishKind): Effect.Effect<number, DomainError> {
		return fromPromise(() => this.ctx.storage.get(`arrival:${kind}`)).pipe(
			Effect.flatMap(value => fromSync(() => decodeSync(arrival, value) ?? 0)),
		);
	}
	reserve(kind: PublishKind): Promise<number> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;

			const slot = reserveSlot(yield* this.theoretical(kind), clock.currentTimeMillisUnsafe(), kind);
			yield* fromPromise(() => this.ctx.storage.put(`arrival:${kind}`, slot.theoretical));
			return slot.allowedAt;
		}));
	}
	defer(until: number): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const entries = {
				'arrival:new': deferSlot(yield* this.theoretical('new'), until, 'new'),
				'arrival:update': deferSlot(yield* this.theoretical('update'), until, 'update'),
			};
			yield* fromPromise(() => this.ctx.storage.put(entries));
		}));
	}
}
