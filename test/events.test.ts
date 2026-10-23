import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Store } from '#automation/store';
import type { AutomationEvent, SubscriptionDelivery } from '#automation/types';

function database(): { store: Store; sqlite: Database } {
	const sqlite = new Database(':memory:');
	for (const name of ['0001_automation.sql', '0002_release_events.sql']) {
		sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
	}
	const prepare = (sql: string, args: unknown[] = []): unknown => ({
		bind: (...values: unknown[]) => prepare(sql, values),
		first: async () => sqlite.query(sql).get(...(args as never[])),
		all: async () => ({ results: sqlite.query(sql).all(...(args as never[])), success: true }),
		run: async () => ({
			success: true,
			meta: { changes: sqlite.query(sql).run(...(args as never[])).changes },
		}),
	});
	const db = {
		prepare,
		batch: async (statements: { run: () => Promise<unknown> }[]) => {
			sqlite.exec('BEGIN');
			try {
				const results = [];
				for (const s of statements) results.push(await s.run());
				sqlite.exec('COMMIT');
				return results;
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
		},
	} as unknown as D1Database;
	return { store: new Store(db), sqlite };
}

test('delivery survives replay and rejects changed event identity', async () => {
	const { store, sqlite } = database();
	const event: AutomationEvent = {
		id: 'event1',
		source: 'example/upstream',
		event: 'package.version.changed',
		version: '1.2.3',
	};
	const delivery = {
		id: 'execution1',
		eventId: event.id,
		repositoryId: 1,
		execution: { id: 'execution1' },
	} as SubscriptionDelivery;
	await store.queueEvent(event, [delivery]);
	await store.queueEvent(event, [delivery]);
	expect((await store.pendingDeliveries()).length).toBe(1);
	await store.deliveryResult(delivery.id, false);
	expect((await store.pendingDeliveries()).length).toBe(1);
	await store.deliveryResult(delivery.id, true);
	await store.queueEvent(event, [delivery]);
	expect(await store.pendingDeliveries()).toEqual([]);
	await expect(store.queueEvent({ ...event, version: '2.0.0' }, [delivery])).rejects.toThrow('Event identity changed');
	sqlite.close();
});
