import { Effect } from 'effect';
import { z } from 'zod';
import { jsrLatest } from '@/automation/managers/jsr';
import { npmLatest } from '@/automation/managers/npm';
import type { Fetcher, RegistryVersion } from '@/automation/managers/registry';
import type { Notifications } from '@/automation/notifications';
import { versionChanged } from '@/automation/notifications';
import type { Store } from '@/automation/store';
import { decodeError } from '@/automation/store';
import type { AutomationEvent, RepositoryRecord } from '@/automation/types';
import type { WatchedPackage } from '@/automation/watchlist';
import { watchlist } from '@/automation/watchlist';
import type { WatchedRegistry } from '@/contract/catalog';
import { watchedRegistries } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { recover } from '@/failure';
import { parse, sql } from '@/persistence/d1/database';

const watchedRow = z.object({
	registry: z.enum(watchedRegistries),
	name: z.string(),
	manual: z.number(),
	version: z.string().nullable(),
	checked_at: z.number().nullable(),
	changed_at: z.number().nullable(),
	error: z.string().nullable(),
	awaiting_release: z.number(),
});

export interface PackageWatch extends WatchedPackage {
	manual: boolean;
	version?: string;
	checkedAt?: number;
	changedAt?: number;
	error?: string;
	awaitingRelease: boolean;
}

const lookups: Record<WatchedRegistry, (name: string, request: Fetcher) => Effect.Effect<RegistryVersion>> = {
	npm: npmLatest,
	jsr: jsrLatest,
};

function key(registry: WatchedRegistry, name: string): string {
	return `${registry}:${name}`;
}

export function packageWatches(
	store: Store,
	repositories: RepositoryRecord[],
): Effect.Effect<PackageWatch[], DomainError> {
	return Effect.gen(function*() {
		const listed = new Map(watchlist(repositories).map(entry => [key(entry.registry, entry.name), entry]));
		const rows = yield* parse(
			z.array(watchedRow),
			yield* sql(store.db).all('SELECT * FROM watched_packages ORDER BY registry, name'),
		);
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
	store: Store,
	notifications: Notifications,
	registry: WatchedRegistry,
	name: string,
	manual: boolean,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const db = sql(store.db);
		const inserted = yield* db.run(
			'INSERT OR IGNORE INTO watched_packages (registry, name, manual, added_at) VALUES (?, ?, ?, ?)',
			registry,
			name,
			Number(manual),
			Date.now(),
		);
		if (inserted.meta.changes > 0) {
			yield* notifications.subscribeNew(registry, name);
		} else if (manual) {
			yield* db.run('UPDATE watched_packages SET manual = 1 WHERE registry = ? AND name = ?', registry, name);
		}
	});
}

export function removeManualWatch(
	store: Store,
	registry: WatchedRegistry,
	name: string,
): Effect.Effect<void, DomainError> {
	return sql(store.db).run('UPDATE watched_packages SET manual = 0 WHERE registry = ? AND name = ?', registry, name)
		.pipe(Effect.asVoid);
}

export function packageEventId(registry: WatchedRegistry, name: string, version: string): string {
	return `package:${registry}:${name}@${version}`;
}

export function pollPackages(
	store: Store,
	repositories: RepositoryRecord[],
	request: Fetcher,
	emit: (event: AutomationEvent) => Effect.Effect<void, DomainError>,
	notifications: Notifications,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const db = sql(store.db);
		const now = Date.now();
		for (const watch of yield* packageWatches(store, repositories)) {
			yield* addWatch(store, notifications, watch.registry, watch.name, false);
			const latest = yield* lookups[watch.registry](watch.name, request).pipe(
				recover(error => Effect.succeed<RegistryVersion>({ kind: 'failed', url: '', reason: decodeError(error) })),
			);
			if (latest.kind !== 'published') {
				yield* db.run(
					'UPDATE watched_packages SET checked_at = ?, error = ?, awaiting_release = CASE WHEN ? AND version IS NULL THEN 1 ELSE awaiting_release END WHERE registry = ? AND name = ?',
					now,
					latest.kind === 'missing' ? 'Not published' : latest.reason,
					Number(latest.kind === 'missing'),
					watch.registry,
					watch.name,
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
			yield* db.run(
				'UPDATE watched_packages SET version = ?, checked_at = ?, error = NULL, awaiting_release = 0, changed_at = CASE WHEN version IS NOT ? THEN ? ELSE changed_at END WHERE registry = ? AND name = ?',
				latest.version,
				now,
				latest.version,
				now,
				watch.registry,
				watch.name,
			);
		}
	});
}
