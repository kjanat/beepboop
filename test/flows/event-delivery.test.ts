import { expect, test } from 'bun:test';
import { jsonFile, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Layer } from 'effect';
import { Automation } from '@/automation/service';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { ReleaseEvents } from '@/notifications/adapters/d1/events.ts';
import type { EventDelivery } from '@/notifications/event-delivery.ts';
import { deliverEvent, deliverPending } from '@/notifications/event-delivery.ts';
import { sql } from '@/persistence/d1/database';
import type { AutomationEvent, Execution } from '@/release/domain/execution/types.ts';
import { ScheduledSweep } from '@/server/scheduled/sweep.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const release: AutomationEvent = {
	id: 'release:tool@2.0.0',
	source: 'octo/tool',
	event: 'release',
	version: '2.0.0',
	release: {
		id: 'tool-release',
		repository: { id: 99, name: 'octo/tool' },
		stream: 'main',
		commit: 'a'.repeat(40),
		version: '2.0.0',
		artifacts: [],
		publications: [],
	},
};

async function follower(operation = 'rebuild') {
	const repository = widget(world.github);
	const configuration = JSON.parse(widgetConfiguration());
	configuration.streams.main.workflows = { rebuild: { file: 'publish.yml' } };
	world.github.push(repository, {
		'.github/beepboop.json': jsonFile({
			...configuration,
			subscriptions: [{
				id: 'follow-tool',
				source: 'octo/tool',
				event: 'release',
				stream: 'main',
				operation,
			}],
		}),
	}, 'Follow tool');
	await world.run(Effect.gen(function*() {
		yield* (yield* Automation).catalog.discover(repository.name, repository.id);
	}));
	const repositories = await world.run(Automation.use(service => service.store.repositories.readable()));
	const enqueued: Execution[] = [];
	let refuse = true;
	const delivery: EventDelivery = {
		events: new ReleaseEvents(sql(world.db)),
		repositories: Effect.succeed(repositories),
		repository: id => Effect.succeed(repositories.find(repository => repository.id === id)),
		packagePublished: () => Effect.die('No package event'),
		openIssue: () => Effect.die('No issue subscription'),
		enqueue: (_, execution) =>
			refuse ? precondition('Coordinator unavailable') : Effect.sync(() => void enqueued.push(execution)),
	};
	return { repository, delivery, enqueued, accept: () => void (refuse = false) };
}

async function deliveryRows() {
	return (await world.db.prepare('SELECT state, error, document FROM subscription_deliveries').all()).results;
}

test('a release event queues one execution for a subscribed repository and retries it until it is enqueued', async () => {
	const { repository, delivery, enqueued, accept } = await follower();
	await world.run(deliverEvent(delivery, release));
	expect(enqueued).toEqual([]);
	expect(await deliveryRows()).toMatchObject([{ state: 'pending', error: 'Delivery awaiting retry' }]);

	accept();
	await world.run(deliverPending(delivery));
	expect(enqueued).toHaveLength(1);
	expect(enqueued[0]).toMatchObject({
		repositoryId: repository.id,
		stream: 'main',
		operation: 'rebuild',
		eventId: `follow-tool:${release.id}`,
		version: '2.0.0',
		upstreamRelease: release.release,
	});
	expect(await deliveryRows()).toMatchObject([{ state: 'delivered', error: null }]);
	expect(await world.run(delivery.events.event(release.id))).toEqual(release);

	await world.run(deliverEvent(delivery, release));
	expect(enqueued).toHaveLength(1);
});

test('a release event without its upstream identity and a changed event body are refused', async () => {
	const { delivery } = await follower();
	const anonymous = await world.run(Effect.flip(deliverEvent(delivery, { ...release, release: undefined })));
	expect(anonymous.message).toBe('Release event requires its upstream identity');
	await world.run(deliverEvent(delivery, release));
	const changed = await world.run(Effect.flip(deliverEvent(delivery, { ...release, occurredAt: 1 })));
	expect(changed.message).toBe('Event identity changed');
});

test('a delivery for a missing repository stays pending', async () => {
	const { delivery, enqueued, accept } = await follower();
	accept();
	await world.run(deliverEvent({ ...delivery, repository: () => Effect.undefined }, release));
	expect(enqueued).toEqual([]);
	expect(await deliveryRows()).toMatchObject([{ state: 'pending', error: 'Delivery awaiting retry' }]);
});

test('an invalid repository configuration receives no delivery', async () => {
	const { delivery } = await follower('release');
	await world.run(deliverEvent(delivery, release));
	expect(await deliveryRows()).toEqual([]);
	expect(await world.run(delivery.events.event(release.id))).toEqual(release);
});

test('the scheduled sweep delivers an outbox release event before it acknowledges it', async () => {
	const { repository } = await follower();
	const coordinator = world.coordinators.instance(String(repository.id));
	await coordinator.storage.put(`release-event:${release.id}`, release);
	await Effect.runPromise(
		ScheduledSweep.use(sweep => sweep.run).pipe(
			Effect.provide(ScheduledSweep.layer.pipe(Layer.provide(world.application))),
		),
	);
	expect(await coordinator.object.releaseEvents()).toEqual([]);
	expect(await world.run(new ReleaseEvents(sql(world.db)).event(release.id))).toEqual(release);
	expect(await deliveryRows()).toMatchObject([{ state: 'delivered', error: null }]);
});
