import { Effect, Semaphore } from 'effect';
import { Automation } from '@/automation/service';
import type { GitHubOutage } from '@/github/status.ts';
import { fetchOutage } from '@/github/status.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

let latest: { at: number; outage: GitHubOutage | undefined } | undefined;
const refreshing = Semaphore.makeUnsafe(1);

export function knownOutage(): GitHubOutage | undefined {
	return latest?.outage;
}

export const refreshOutage: Effect.Effect<void, DomainError, Automation> = Semaphore.withPermit(
	refreshing,
	Effect.clockWith(clock =>
		latest && clock.currentTimeMillisUnsafe() - latest.at < 60_000
			? Effect.void
			: check.pipe(Effect.flatMap(outage =>
				Effect.sync(() => {
					latest = { at: clock.currentTimeMillisUnsafe(), outage };
				})
			))
	),
);

export const githubOutage: Effect.Effect<GitHubOutage | undefined, DomainError, Automation> = refreshOutage.pipe(
	Effect.map(knownOutage),
);

const check: Effect.Effect<GitHubOutage | undefined, DomainError, Automation> = Effect.flatMap(
	Automation,
	service => fetchOutage(service.dependencies.transport),
);
