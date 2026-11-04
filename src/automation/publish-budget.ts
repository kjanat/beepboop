import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { deferSlot, reserveSlot } from '@/automation/publish-pace';
import type { PublishKind } from '@/automation/types';

const arrival = z.number().optional();

export class PublishBudget extends DurableObject<unknown> {
	private async theoretical(kind: PublishKind): Promise<number> {
		return arrival.parse(await this.ctx.storage.get(`arrival:${kind}`)) ?? 0;
	}
	async reserve(kind: PublishKind): Promise<number> {
		const slot = reserveSlot(await this.theoretical(kind), Date.now(), kind);
		await this.ctx.storage.put(`arrival:${kind}`, slot.theoretical);
		return slot.allowedAt;
	}
	async defer(until: number): Promise<void> {
		await this.ctx.storage.put({
			'arrival:new': deferSlot(await this.theoretical('new'), until, 'new'),
			'arrival:update': deferSlot(await this.theoretical('update'), until, 'update'),
		});
	}
}
