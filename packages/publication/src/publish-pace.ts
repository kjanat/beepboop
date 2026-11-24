import { Context, Effect, Layer } from 'effect';
import type { ManagerName } from '@/domain/catalog.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export type PublishKind = 'new' | 'update';

export const publishBudgets: Record<PublishKind, { burst: number; interval: number }> = {
	new: { burst: 5, interval: 600_000 },
	update: { burst: 30, interval: 60_000 },
};

export function reserveSlot(
	theoretical: number,
	now: number,
	kind: PublishKind,
): { allowedAt: number; theoretical: number } {
	const { burst, interval } = publishBudgets[kind];
	const start = Math.max(theoretical, now);
	return { allowedAt: Math.max(now, start - (burst - 1) * interval), theoretical: start + interval };
}

export function deferSlot(theoretical: number, until: number, kind: PublishKind): number {
	const { burst, interval } = publishBudgets[kind];
	return Math.max(theoretical, until + (burst - 1) * interval);
}

const pacedManagers = ['cargo'] as const satisfies readonly ManagerName[];
export type PacedManager = (typeof pacedManagers)[number];
const budgets: Record<PacedManager, string> = { cargo: 'crates-io' };

export function paced(manager: ManagerName | undefined): manager is PacedManager {
	return pacedManagers.some(name => name === manager);
}

export interface PublishBudgetClient {
	reserve(kind: PublishKind): Promise<number>;
	defer(until: number): Promise<void>;
}

export class PublishPacing extends Context.Service<PublishPacing, {
	readonly reserve: (manager: PacedManager, kind: PublishKind) => Effect.Effect<number, DomainError>;
	readonly defer: (manager: ManagerName | undefined, until: number) => Effect.Effect<void, DomainError>;
}>()('beepboopbot/publication/PublishPacing') {
	static layer(budget: (name: string) => PublishBudgetClient): Layer.Layer<PublishPacing> {
		return Layer.succeed(PublishPacing, {
			reserve: (manager, kind) => fromPromise(() => budget(budgets[manager]).reserve(kind)),
			defer: (manager, until) =>
				paced(manager) ? fromPromise(() => budget(budgets[manager]).defer(until)) : Effect.void,
		});
	}
}
