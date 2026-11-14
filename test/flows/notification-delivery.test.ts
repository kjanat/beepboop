import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrationFiles, migrationsDirectory, TestD1 } from '@root/test/support/d1.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { Fetcher } from '@/automation/managers/registry';
import { Notifications, versionChanged } from '@/automation/notifications';
import { Store } from '@/automation/store';
import { sql } from '@/persistence/d1/database';
import { deliveryLeaseDuration, NotificationDeliveries } from '@/persistence/d1/notification-deliveries';

let world: World;
eachWorld(created => {
	world = created;
});

async function staged(
	request: Fetcher,
	reveal = () => Effect.succeed({ value: 'https://example.test/hook', version: 1 }),
) {
	const notifications = new Notifications(new Store(world.db), () => ({
		reveal,
	}), request);
	await world.sealCredential('notification-url');
	const destination = await world.run(
		notifications.saveDestination({
			name: 'Releases',
			kind: 'http',
			credential: 'notification-url',
			enabled: true,
			subscribeNew: false,
		}, 'admin'),
	);
	await world.run(
		notifications.setSubscription({ destinationId: destination, registry: 'npm', name: 'widget' }, true, 'admin'),
	);
	await world.run(notifications.stage(versionChanged('event', 'npm', 'widget', '1.0.0', '1.1.0')));
	const [delivery] = await world.run(notifications.recent());
	if (!delivery) throw new Error('Expected a staged delivery');
	return { notifications, destination, id: delivery.id, deliveries: new NotificationDeliveries(sql(world.db)) };
}

test('overlapping delivery passes send an item only once while its owner is sending', async () => {
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	let sends = 0;
	const { notifications } = await staged(async () => {
		sends++;
		entered.resolve();
		await resume.promise;
		return new Response(null, { status: 204 });
	});
	const first = world.run(notifications.deliver());
	await entered.promise;
	await world.run(notifications.deliver());
	expect(sends).toBe(1);
	expect((await world.run(notifications.recent()))[0]).toMatchObject({ state: 'sending', attempts: 1 });
	resume.resolve();
	await first;
	expect((await world.run(notifications.recent()))[0]).toMatchObject({ state: 'delivered', attempts: 1 });
});

test('an abandoned claim expires, and the old owner cannot settle the new attempt', async () => {
	const { deliveries, id } = await staged(async () => new Response(null, { status: 204 }));
	const first = await world.run(deliveries.claim(id));
	if (!first) throw new Error('Expected first claim');
	expect(await world.run(deliveries.claim(id))).toBeUndefined();
	world.advance(deliveryLeaseDuration);
	const second = await world.run(new NotificationDeliveries(sql(world.db)).claim(id));
	if (!second) throw new Error('Expected recovered claim');
	expect(second.lease).not.toBe(first.lease);
	expect(second.attempts).toBe(2);
	await world.run(deliveries.settle(first, { state: 'failed', error: 'Late failure' }));
	expect((await world.run(deliveries.recent()))[0]).toEqual(second);
	await world.run(deliveries.settle(second, { state: 'delivered' }));
	await world.run(deliveries.settle(first, { state: 'pending', error: 'Late retry' }));
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({
		state: 'delivered',
		attempts: 2,
		error: null,
		lease: null,
		lease_until: null,
	});
});

test('five abandoned attempts exhaust the delivery without a sixth send', async () => {
	let sends = 0;
	const { deliveries, notifications, id } = await staged(async () => {
		sends++;
		return new Response(null, { status: 204 });
	});
	for (let attempt = 1; attempt <= 5; attempt++) {
		expect(await world.run(deliveries.claim(id))).toMatchObject({ attempts: attempt });
		world.advance(deliveryLeaseDuration);
	}
	await world.run(notifications.deliver());
	expect(sends).toBe(0);
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({ state: 'failed', attempts: 5, lease: null });
});

test('destination removal invalidates an in-flight claim', async () => {
	const { deliveries, notifications, id, destination } = await staged(async () => new Response(null, { status: 204 }));
	const claim = await world.run(deliveries.claim(id));
	if (!claim) throw new Error('Expected claim');
	await world.run(notifications.removeDestination(destination, 'admin'));
	await world.run(deliveries.settle(claim, { state: 'delivered' }));
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({
		state: 'failed',
		error: 'Destination removed',
		lease: null,
	});
});

test('destination removal during secret retrieval prevents a request from starting', async () => {
	const entered = Promise.withResolvers<void>();
	const resume = Promise.withResolvers<void>();
	let sends = 0;
	const { notifications, destination, deliveries } = await staged(
		async () => {
			sends++;
			return new Response(null, { status: 204 });
		},
		() => Effect.promise(async () => {
			entered.resolve();
			await resume.promise;
			return { value: 'https://example.test/hook', version: 1 };
		}),
	);
	const delivery = world.run(notifications.deliver());
	await entered.promise;
	await world.run(notifications.removeDestination(destination, 'admin'));
	resume.resolve();
	await delivery;
	expect(sends).toBe(0);
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({
		state: 'failed',
		error: 'Destination removed',
		attempts: 1,
		lease: null,
	});
});

test('retryable responses exhaust their budget and malformed payloads fail without sending', async () => {
	let sends = 0;
	const { notifications, deliveries, id } = await staged(async () => {
		sends++;
		return new Response(null, { status: 503 });
	});
	for (let attempt = 0; attempt < 6; attempt++) await world.run(notifications.deliver());
	expect(sends).toBe(5);
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({ state: 'failed', attempts: 5 });
	await world.db.prepare(
		"UPDATE notification_deliveries SET state='pending', attempts=0, document='bad json' WHERE id=?",
	).bind(id).run();
	await world.run(notifications.deliver());
	expect(sends).toBe(5);
	expect((await world.run(deliveries.recent()))[0]).toMatchObject({
		state: 'failed',
		error: 'Invalid notification payload',
	});
});

test('the delivery migration preserves old work and rejects contradictory states', async () => {
	const db = new TestD1(migrationFiles().filter(file => file < '0015'));
	for (const state of ['pending', 'delivered', 'failed']) {
		await db.prepare(
			'INSERT INTO notification_deliveries(id,event_id,destination_id,document,state,attempts,updated_at) VALUES(?,?,?,?,?,1,?)',
		).bind(state, state, 'destination', '{}', state, Date.now()).run();
	}
	db.sqlite.run(readFileSync(join(migrationsDirectory, '0015_notification_claims.sql'), 'utf8'));
	const deliveries = new NotificationDeliveries(sql(db));
	expect((await world.run(deliveries.recent())).map(row => row.state).sort()).toEqual([
		'delivered',
		'failed',
		'pending',
	]);
	for (const assignment of [
		"state='sending'",
		"state='failed',error=NULL",
		"state='delivered',error='failure'",
		"lease='orphan'",
		'attempts=-1',
	]) {
		expect(() => db.execute(`UPDATE notification_deliveries SET ${assignment} WHERE id='pending'`, [])).toThrow();
	}
	db.sqlite.close();
});
