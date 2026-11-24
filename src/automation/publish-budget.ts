import { DurableObject } from 'cloudflare:workers';
import { Clock, Effect, Schema } from 'effect';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import type { PublishKind } from '@/publication/publish-pace.ts';
import { deferSlot, reserveSlot } from '@/publication/publish-pace.ts';

const arrival = Schema.optional(Schema.Finite);

const retention = 86_400_000;

export class PublishBudget extends DurableObject<unknown> {
	private stored(key: string): Effect.Effect<number | undefined, DomainError> {
		return fromPromise(() => this.ctx.storage.get(key)).pipe(
			Effect.flatMap(value => fromSync(() => decodeSync(arrival, value))),
		);
	}
	private theoretical(kind: PublishKind): Effect.Effect<number, DomainError> {
		return this.stored(`arrival:${kind}`).pipe(Effect.map(value => value ?? 0));
	}
	private prune(now: number): Effect.Effect<void, DomainError> {
		return fromPromise(async () => {
			const held = await this.ctx.storage.list({ prefix: 'reservation:' });
			const expired = [...held].filter(([, value]) => typeof value === 'number' && value < now - retention);
			if (expired.length) await this.ctx.storage.delete(expired.map(([key]) => key));
		});
	}
	reserve(kind: PublishKind, id: string): Promise<number> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const clock = yield* Clock.Clock;
			const now = clock.currentTimeMillisUnsafe();
			const key = `reservation:${kind}:${id}`;
			const cooldown = (yield* this.stored('cooldown')) ?? 0;
			const held = yield* this.stored(key);
			if (held !== undefined) return Math.max(held, cooldown);
			const slot = reserveSlot(yield* this.theoretical(kind), now, kind);
			yield* fromPromise(() => this.ctx.storage.put({ [`arrival:${kind}`]: slot.theoretical, [key]: slot.allowedAt }));
			yield* this.prune(now);
			return Math.max(slot.allowedAt, cooldown);
		}));
	}
	defer(until: number): Promise<void> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const entries = {
				'arrival:new': deferSlot(yield* this.theoretical('new'), until, 'new'),
				'arrival:update': deferSlot(yield* this.theoretical('update'), until, 'update'),
				cooldown: Math.max((yield* this.stored('cooldown')) ?? 0, until),
			};
			yield* fromPromise(() => this.ctx.storage.put(entries));
		}));
	}
}
