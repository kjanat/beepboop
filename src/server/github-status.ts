import { Effect, Semaphore } from 'effect';
import { Automation } from '@/automation/service';
import type { GitHubOutage } from '@/github/status.ts';
import { fetchOutage } from '@/github/status.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';

interface Snapshot {
	readonly at: number;
	readonly outage: GitHubOutage | undefined;
}

const snapshots = new WeakMap<Fetcher, Snapshot>();
const refreshing = Semaphore.makeUnsafe(1);

export function knownOutage(transport: Fetcher): GitHubOutage | undefined {
	return snapshots.get(transport)?.outage;
}

export const refreshOutage: Effect.Effect<void, DomainError, Automation> = Semaphore.withPermit(
	refreshing,
	Effect.flatMap(Automation, ({ dependencies: { transport } }) =>
		Effect.clockWith(clock => {
			const latest = snapshots.get(transport);
			return latest && clock.currentTimeMillisUnsafe() - latest.at < 60_000
				? Effect.void
				: fetchOutage(transport).pipe(Effect.flatMap(outage =>
					Effect.sync(() => {
						snapshots.set(transport, { at: clock.currentTimeMillisUnsafe(), outage });
					})
				));
		})),
);

export const githubOutage: Effect.Effect<GitHubOutage | undefined, DomainError, Automation> = Effect.flatMap(
	Automation,
	({ dependencies: { transport } }) => refreshOutage.pipe(Effect.map(() => knownOutage(transport))),
);
