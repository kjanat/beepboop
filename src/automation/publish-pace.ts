import type { PublishKind } from '@/automation/types';

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
