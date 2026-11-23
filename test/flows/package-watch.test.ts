import { expect, test } from 'bun:test';
import { call, cliTransport } from '@root/test/support/client.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import type { AutomationEvent } from '@/automation/types';
import { routes } from '@/contract/routes';
import { Notifications } from '@/notifications/delivery.ts';
import { versionChanged } from '@/notifications/notification.ts';
import { addWatch, packageWatches, pollPackages } from '@/notifications/package-watch.ts';

let world: World;
eachWorld(created => {
	world = created;
});

function watcher() {
	const notifications = new Notifications(world.db, () => ({
		reveal: () => Effect.succeed({ value: 'https://example.test/hook', version: 1 }),
	}));
	const events: AutomationEvent[] = [];
	const poll = () =>
		world.run(
			pollPackages(
				world.db,
				[],
				world.network.fetch,
				event => Effect.sync(() => void events.push(event)),
				notifications,
			),
		);
	return { notifications, events, poll };
}

test('a manual watch subscribes new-package destinations and announces the first release once', async () => {
	const transport = cliTransport(world, await world.cliSession());
	await world.sealCredential('hook');
	const { notifications, events, poll } = watcher();
	const destination = await world.run(notifications.saveDestination({
		name: 'Releases',
		kind: 'http',
		credential: 'hook',
		enabled: true,
		subscribeNew: true,
	}, 'admin'));
	await call(routes.packagesAdd, { registry: 'npm', name: 'engine' }, transport);
	expect(await world.run(notifications.subscriptions())).toEqual([
		{ destinationId: destination, registry: 'npm', name: 'engine' },
	]);

	await poll();
	expect(await world.run(packageWatches(world.db, []))).toMatchObject([
		{ registry: 'npm', name: 'engine', manual: true, error: 'Not published', awaitingRelease: true },
	]);
	world.npm.publish('engine', '1.0.0');
	await poll();
	await poll();
	expect(events).toEqual([
		{ id: 'package:npm:engine@1.0.0', source: 'npm:engine', event: 'package.version.changed', version: '1.0.0' },
	]);
	expect((await world.run(notifications.recent())).map(delivery => delivery.payload)).toEqual([
		versionChanged('package:npm:engine@1.0.0', 'npm', 'engine', null, '1.0.0'),
	]);
	expect(await world.run(packageWatches(world.db, []))).toMatchObject([
		{ registry: 'npm', name: 'engine', manual: true, version: '1.0.0', awaitingRelease: false },
	]);

	await call(routes.packagesRemove, { registry: 'npm', name: 'engine' }, transport);
	expect(await world.run(packageWatches(world.db, []))).toEqual([]);
	const audit = await world.db.prepare("SELECT action, target FROM audit WHERE action LIKE 'package.%'").all();
	expect(audit.results).toEqual(expect.arrayContaining([
		{ action: 'package.watch', target: 'npm:engine' },
		{ action: 'package.unwatch', target: 'npm:engine' },
	]));
	expect(audit.results).toHaveLength(2);
});

test('a manual add marks an existing watch manual and a new version emits one event', async () => {
	const transport = cliTransport(world, await world.cliSession());
	const { notifications, events, poll } = watcher();
	world.npm.publish('engine', '1.0.0');
	await world.run(addWatch(world.db, notifications, 'npm', 'engine', false));
	expect(await world.run(packageWatches(world.db, []))).toEqual([]);
	await call(routes.packagesAdd, { registry: 'npm', name: 'engine' }, transport);
	await poll();
	expect(events).toEqual([]);
	world.npm.publish('engine', '1.1.0');
	await poll();
	expect(events).toEqual([
		{ id: 'package:npm:engine@1.1.0', source: 'npm:engine', event: 'package.version.changed', version: '1.1.0' },
	]);
	expect(await world.run(packageWatches(world.db, []))).toMatchObject([
		{ registry: 'npm', name: 'engine', manual: true, version: '1.1.0', awaitingRelease: false },
	]);
});
