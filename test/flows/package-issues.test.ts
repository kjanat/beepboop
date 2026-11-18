import { expect, test } from 'bun:test';
import { jsonFile, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { Automation } from '@/automation/service';

let world: World;
eachWorld(created => {
	world = created;
});

test('a watched package version opens one issue directly in the subscribed repository', async () => {
	const repository = widget(world.github);
	const config = JSON.parse(widgetConfiguration());
	world.github.push(repository, {
		'.github/beepboop.json': jsonFile({
			...config,
			subscriptions: [{
				id: 'update-engine',
				source: 'npm:engine',
				event: 'package.version.changed',
				issue: { title: 'Update engine to v{version}', body: 'Rebase onto v{version}.' },
			}],
		}),
	}, 'Watch engine');
	const issues: unknown[] = [];
	world.network.serve('api.github.com', async request => {
		if (new URL(request.url).pathname !== `/repos/${repository.name}/issues`) return world.github.handle(request);
		if (request.method === 'GET') return Response.json(issues);
		expect(request.method).toBe('POST');
		issues.push(await request.json());
		// The write reached GitHub, but its response was lost.
		return Response.json({ message: 'Unavailable' }, { status: 502 });
	});
	const reconcile = () => world.run(Automation.use(service => service.scheduled));
	await world.run(Effect.gen(function*() {
		yield* (yield* Automation).discover(repository.name, repository.id);
	}));

	world.npm.publish('engine', '1.0.0');
	await reconcile();
	expect(issues).toEqual([]);
	world.npm.publish('engine', '1.1.0');
	await reconcile();
	await reconcile();
	expect(issues).toEqual([{ title: 'Update engine to v1.1.0', body: 'Rebase onto v1.1.0.' }]);
	expect(await world.db.prepare("SELECT state FROM subscription_deliveries WHERE state='delivered'").first()).toEqual({
		state: 'delivered',
	});
});
