import { expect, spyOn, test } from 'bun:test';
import { durableObjectState } from '@root/test/support/do-storage.ts';
import { loggedErrors } from '@root/test/support/process.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { AutomationCoordinator } from '@/automation/coordinator';

let world: World;
eachWorld(created => {
	world = created;
});

async function armed(entries: Record<string, unknown>, alarm?: number): Promise<number | null> {
	const storage = world.storage('AutomationCoordinator:alarms');
	if (Object.keys(entries).length) await storage.put(entries);
	if (alarm !== undefined) await storage.setAlarm(alarm);
	const coordinator = new AutomationCoordinator(durableObjectState('alarms', storage), world.env, world.application);
	try {
		await coordinator.reindex(1);
	} finally {
		await AutomationCoordinator.dispose(coordinator);
	}
	return storage.alarm;
}

const inbox = (due: number) => ({
	delivery: 'd',
	repositoryId: 1,
	event: { kind: 'push', ref: 'main' },
	attempts: 0,
	due,
});
const setupEdit = (due: number) => ({
	repositoryId: 1,
	number: 2,
	head: 'h',
	body: 'b',
	choices: { streams: [] },
	due,
});

test('each due source arms the coordinator alarm at its own time', async () => {
	const now = Date.now();
	expect(await armed({})).toBeNull();
	expect(await armed({ 'release-wake:p': { due: now + 1_000 } })).toBe(now + 1_000);
	expect(await armed({ 'release-wake:p': true })).toBe(0);
	expect(await armed({ 'observe:7': { repositoryId: 1, runId: 7, due: now + 2_000 } })).toBe(now + 2_000);
	expect(await armed({ 'observe:7': { repositoryId: 1, runId: 7 } })).toBe(now);
	expect(await armed({ 'track:7': { repositoryId: 1, runId: 7, due: now + 3_000 } })).toBe(now + 3_000);
	expect(await armed({ 'track:7': { repositoryId: 1, runId: 7 } })).toBe(now);
	expect(await armed({ 'inbox:d': inbox(now + 4_000) })).toBe(now + 4_000);
	expect(await armed({ 'reconcile-at': now + 5_000 })).toBe(now + 5_000);
	expect(await armed({ 'reconcile-at': null })).toBeNull();
	expect(await armed({ 'setup-edit': setupEdit(now + 6_000) })).toBe(now + 6_000);
});

test('an unreadable queue entry arms the alarm now, an unreadable reconcile time arms nothing, and an unreadable setup edit fails', async () => {
	const now = Date.now();
	for (const key of ['release-wake:p', 'observe:7', 'track:7', 'inbox:d']) {
		expect(await armed({ [key]: { broken: true } })).toBe(now);
	}
	expect(await armed({ 'reconcile-at': 'soon' })).toBeNull();
	await expect(armed({ 'setup-edit': { broken: true } })).rejects.toThrow('Internal error');
});

test('an outbox that fails to project arms the alarm at the projection retry', async () => {
	spyOn(world.db, 'batch').mockImplementation(() => Promise.reject(new Error('D1_ERROR: Network connection lost.')));
	const outbox = { entity: 'release', id: 'r', repositoryId: 1, revision: 1 };
	const logged = loggedErrors();
	expect(await armed({ 'release:r': { id: 'r' }, 'outbox:0000000000000001': outbox })).toBe(Date.now() + 10_000);
	expect(logged.events()).toEqual([expect.objectContaining({ event: 'projection.failed' })]);
});

test('arming keeps an earlier alarm and moves a later one forward', async () => {
	const now = Date.now();
	expect(await armed({ 'reconcile-at': now + 5_000 }, now + 1_000)).toBe(now + 1_000);
	expect(await armed({ 'reconcile-at': now + 5_000 }, now + 9_000)).toBe(now + 5_000);
});

test('the coordinator alarm fires at the earliest of all due sources', async () => {
	const now = Date.now();
	const sources = {
		'release-wake:p': { due: now + 6_000 },
		'observe:7': { repositoryId: 1, runId: 7, due: now + 5_000 },
		'track:7': { repositoryId: 1, runId: 7, due: now + 4_000 },
		'inbox:d': inbox(now + 3_000),
		'reconcile-at': now + 2_000,
		'setup-edit': setupEdit(now + 1_000),
	};
	expect(await armed(sources)).toBe(now + 1_000);
	expect(await armed({ ...sources, 'setup-edit': setupEdit(now + 7_000) })).toBe(now + 2_000);
});
