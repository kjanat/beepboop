import { z } from 'zod';
import { jsrLatest } from '@/automation/managers/jsr';
import { npmLatest } from '@/automation/managers/npm';
import type { Fetcher, RegistryVersion } from '@/automation/managers/registry';
import { type Notifications, versionChanged } from '@/automation/notifications';
import type { Store } from '@/automation/store';
import type { AutomationEvent, RepositoryRecord } from '@/automation/types';
import { type WatchedPackage, watchlist } from '@/automation/watchlist';
import { type WatchedRegistry, watchedRegistries } from '@/contract/catalog';

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

const lookups: Record<WatchedRegistry, (name: string, request: Fetcher) => Promise<RegistryVersion>> = {
	npm: npmLatest,
	jsr: jsrLatest,
};

function key(registry: WatchedRegistry, name: string): string {
	return `${registry}:${name}`;
}

export async function packageWatches(store: Store, repositories: RepositoryRecord[]): Promise<PackageWatch[]> {
	const listed = new Map(watchlist(repositories).map(entry => [key(entry.registry, entry.name), entry]));
	const rows = z.array(watchedRow).parse(
		(await store.db.prepare('SELECT * FROM watched_packages ORDER BY registry, name').all()).results,
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
}

export async function addWatch(
	store: Store,
	notifications: Notifications,
	registry: WatchedRegistry,
	name: string,
	manual: boolean,
): Promise<void> {
	const inserted = await store.db
		.prepare('INSERT OR IGNORE INTO watched_packages (registry, name, manual, added_at) VALUES (?, ?, ?, ?)')
		.bind(registry, name, Number(manual), Date.now())
		.run();
	if (inserted.meta.changes > 0) {
		await notifications.subscribeNew(registry, name);
	} else if (manual) {
		await store.db.prepare('UPDATE watched_packages SET manual = 1 WHERE registry = ? AND name = ?').bind(
			registry,
			name,
		)
			.run();
	}
}

export async function removeManualWatch(store: Store, registry: WatchedRegistry, name: string): Promise<void> {
	await store.db.prepare('UPDATE watched_packages SET manual = 0 WHERE registry = ? AND name = ?').bind(registry, name)
		.run();
}

export function packageEventId(registry: WatchedRegistry, name: string, version: string): string {
	return `package:${registry}:${name}@${version}`;
}

export async function pollPackages(
	store: Store,
	repositories: RepositoryRecord[],
	request: Fetcher,
	emit: (event: AutomationEvent) => Promise<void>,
	notifications: Notifications,
): Promise<void> {
	const now = Date.now();
	for (const watch of await packageWatches(store, repositories)) {
		await addWatch(store, notifications, watch.registry, watch.name, false);
		let latest: RegistryVersion;
		try {
			latest = await lookups[watch.registry](watch.name, request);
		} catch (error) {
			latest = { kind: 'failed', url: '', reason: error instanceof Error ? error.message : 'Lookup failed' };
		}
		if (latest.kind !== 'published') {
			await store.db
				.prepare(
					'UPDATE watched_packages SET checked_at = ?, error = ?, awaiting_release = CASE WHEN ? AND version IS NULL THEN 1 ELSE awaiting_release END WHERE registry = ? AND name = ?',
				)
				.bind(
					now,
					latest.kind === 'missing' ? 'Not published' : latest.reason,
					Number(latest.kind === 'missing'),
					watch.registry,
					watch.name,
				)
				.run();
			continue;
		}
		const firstRelease = watch.version === undefined && watch.awaitingRelease;
		if (firstRelease || (watch.version !== undefined && watch.version !== latest.version)) {
			const id = packageEventId(watch.registry, watch.name, latest.version);
			await emit({
				id,
				source: key(watch.registry, watch.name),
				event: 'package.version.changed',
				version: latest.version,
			});
			await notifications.stage(versionChanged(id, watch.registry, watch.name, watch.version ?? null, latest.version));
		}
		await store.db
			.prepare(
				'UPDATE watched_packages SET version = ?, checked_at = ?, error = NULL, awaiting_release = 0, changed_at = CASE WHEN version IS NOT ? THEN ? ELSE changed_at END WHERE registry = ? AND name = ?',
			)
			.bind(latest.version, now, latest.version, now, watch.registry, watch.name)
			.run();
	}
}
