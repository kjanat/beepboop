import { Clock, Effect } from 'effect';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import type { RepositoryRecord } from '@/domain/inventory.ts';
import { recover } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { WatchedPackages } from '@/notifications/adapters/d1/watched-packages.ts';
import type { Notifications } from '@/notifications/delivery.ts';
import { versionChanged } from '@/notifications/notification.ts';
import type { WatchedPackage } from '@/notifications/watchlist.ts';
import { watchlist } from '@/notifications/watchlist.ts';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';
import { sql } from '@/persistence/d1/database';
import { jsrLatest } from '@/publication/registries/jsr.ts';
import { npmLatest } from '@/publication/registries/npm.ts';
import type { LookupOutcome } from '@/publication/registries/outcome.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import type { AutomationEvent } from '@/release/domain/execution/types.ts';

export interface PackageWatch extends WatchedPackage {
	manual: boolean;
	version?: string;
	checkedAt?: number;
	changedAt?: number;
	error?: string;
	awaitingRelease: boolean;
}

const lookups: Record<WatchedRegistry, (name: string, request: Fetcher) => Effect.Effect<LookupOutcome>> = {
	npm: npmLatest,
	jsr: jsrLatest,
};

function key(registry: WatchedRegistry, name: string): string {
	return `${registry}:${name}`;
}

export function packageWatches(
	db: SqlDatabase | Sql,
	repositories: RepositoryRecord[],
): Effect.Effect<PackageWatch[], DomainError> {
	return Effect.gen(function*() {
		const listed = new Map(watchlist(repositories).map(entry => [key(entry.registry, entry.name), entry]));
		const rows = yield* new WatchedPackages(sql(db)).list();
		const watches = new Map<string, PackageWatch>();
		for (const row of rows) {
			const entry = listed.get(key(row.registry, row.name));
			if (!entry && row.manual !== 1) continue;
			watches.set(key(row.registry, row.name), {
				registry: row.registry,
				name: row.name,
				publishers: entry?.publishers ?? [],
				dependents: entry?.dependents ?? [],
				manual: row.manual === 1,
				...(row.version === null ? {} : { version: row.version }),
				...(row.checked_at === null ? {} : { checkedAt: row.checked_at }),
				...(row.changed_at === null ? {} : { changedAt: row.changed_at }),
				...(row.error === null ? {} : { error: row.error }),
				awaitingRelease: row.awaiting_release === 1,
			});
		}
		for (const [id, entry] of listed) {
			if (!watches.has(id)) watches.set(id, { ...entry, manual: false, awaitingRelease: false });
		}
		return [...watches.values()].sort((a, b) => key(a.registry, a.name).localeCompare(key(b.registry, b.name)));
	});
}

export function addWatch(
	db: SqlDatabase | Sql,
	notifications: Notifications,
	registry: WatchedRegistry,
	name: string,
	manual: boolean,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const clock = yield* Clock.Clock;

		const watched = new WatchedPackages(sql(db));
		const inserted = yield* watched.insert(registry, name, manual, clock.currentTimeMillisUnsafe());
		if (inserted) {
			yield* notifications.subscribeNew(registry, name);
		} else if (manual) {
			yield* watched.markManual(registry, name);
		}
	});
}

export function removeManualWatch(
	db: SqlDatabase | Sql,
	registry: WatchedRegistry,
	name: string,
): Effect.Effect<void, DomainError> {
	return new WatchedPackages(sql(db)).clearManual(registry, name);
}

export function packageEventId(registry: WatchedRegistry, name: string, version: string): string {
	return `package:${registry}:${name}@${version}`;
}

export function pollPackages(
	db: SqlDatabase | Sql,
	repositories: RepositoryRecord[],
	request: Fetcher,
	emit: (event: AutomationEvent) => Effect.Effect<void, DomainError>,
	notifications: Notifications,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const clock = yield* Clock.Clock;

		const watched = new WatchedPackages(sql(db));
		const now = clock.currentTimeMillisUnsafe();
		for (const watch of yield* packageWatches(db, repositories)) {
			yield* addWatch(db, notifications, watch.registry, watch.name, false);
			const latest = yield* lookups[watch.registry](watch.name, request).pipe(
				recover(error => Effect.succeed(VerificationOutcome.LookupFailed({ url: '', reason: decodeError(error) }))),
			);
			if (latest._tag !== 'Published') {
				yield* watched.unpublished(
					watch.registry,
					watch.name,
					now,
					latest._tag === 'Missing' ? 'Not published' : latest.reason,
					latest._tag === 'Missing',
				);
				continue;
			}
			const firstRelease = watch.version === undefined && watch.awaitingRelease;
			if (firstRelease || (watch.version !== undefined && watch.version !== latest.version)) {
				const id = packageEventId(watch.registry, watch.name, latest.version);
				yield* emit({
					id,
					source: key(watch.registry, watch.name),
					event: 'package.version.changed',
					version: latest.version,
				});
				yield* notifications.stage(
					versionChanged(id, watch.registry, watch.name, watch.version ?? null, latest.version),
				);
			}
			yield* watched.published(watch.registry, watch.name, latest.version, now);
		}
	});
}
