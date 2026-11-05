import { DurableObject } from 'cloudflare:workers';
import { Effect } from 'effect';
import { z } from 'zod';
import { deferSlot, reserveSlot } from '@/automation/publish-pace';
import type { PublishKind } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { fromPromise, fromSync } from '@/failure';

const arrival = z.number().optional();

export class PublishBudget extends DurableObject<unknown> {
	private theoretical(kind: PublishKind): Effect.Effect<number, DomainError> {
		return fromPromise(() => this.ctx.storage.get(`arrival:${kind}`)).pipe(
			Effect.flatMap(value => fromSync(() => arrival.parse(value) ?? 0)),
		);
	}
	reserve(kind: PublishKind): Promise<number> {
		return Effect.runPromise(Effect.gen({ self: this }, function*() {
			const slot = reserveSlot(yield* this.theoretical(kind), Date.now(), kind);
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
