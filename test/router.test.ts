import { Router } from '@/router.ts';
import { describe, expect, test } from 'bun:test';
import { FakeGitHub, MemoryJournal, release, route, run } from './fixtures.ts';

function setup() {
	const journal = new MemoryJournal();
	const github = new FakeGitHub();
	let now = 1_000_000;
	const router = new Router(journal, github, () => now);
	return {
		journal,
		github,
		router,
		advance: (milliseconds = 60_001) => {
			now += milliseconds;
		},
		tick: async () => {
			const operation = await journal.get('11:44:scoop');
			if (!operation) throw new Error('Missing operation');
			await router.tick(route, operation);
		},
	};
}
describe('persistent routing', () => {
	test('duplicate webhooks produce one dispatch, success requires downstream completion', async () => {
		const t = setup();
		await t.router.discover(route);
		await t.router.discover(route);
		await t.tick();
		expect(t.github.dispatches).toBe(1);
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('dispatched');
		t.advance();
		await t.tick();
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('dispatched');
		t.github.currentRun = { ...run(), status: 'completed', conclusion: 'success' };
		t.advance();
		await t.tick();
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('succeeded');
		await t.router.discover(route);
		await t.tick();
		expect(t.github.dispatches).toBe(1);
	});
	test('waits for route-specific publication evidence', async () => {
		const t = setup();
		t.github.readyValue = false;
		await t.router.discover(route);
		await t.tick();
		expect(t.github.dispatches).toBe(0);
		t.github.readyValue = true;
		t.advance();
		await t.tick();
		expect(t.github.dispatches).toBe(1);
	});
	test.each(['tag', 'asset', 'deleted'])('rejects changed %s identity', async (kind) => {
		const t = setup();
		await t.router.discover(route);
		if (kind === 'tag') t.github.value = { ...release(), sha: 'd'.repeat(40) };
		if (kind === 'asset') {
			t.github.value = {
				...release(),
				assets: [{ id: 99, name: 'SHA256SUMS', size: 100, digest: `sha256:${'b'.repeat(64)}` }],
			};
		}
		if (kind === 'deleted') t.github.value = null;
		await t.tick();
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('failed');
		expect(t.github.dispatches).toBe(0);
	});
	test('ambiguous dispatch reconciles after restart without duplicate dispatch', async () => {
		const t = setup();
		t.github.loseResponse = true;
		await t.router.discover(route);
		await t.tick();
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('dispatching');
		t.github.foundRun = run();
		const restarted = new Router(t.journal, t.github, () => 1_100_000);
		const operation = await t.journal.get('11:44:scoop');
		if (!operation) throw new Error('Missing operation');
		await restarted.tick(route, operation);
		expect(t.github.dispatches).toBe(1);
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('dispatched');
	});
	test('retries ambiguous dispatch only after reconciliation grace', async () => {
		const t = setup();
		t.github.loseResponse = true;
		await t.router.discover(route);
		await t.tick();
		t.advance();
		await t.tick();
		expect(t.github.dispatches).toBe(1);
		t.advance(600_001);
		t.github.loseResponse = false;
		await t.tick();
		expect(t.github.dispatches).toBe(2);
	});
	test('destination failure is visible and never reported as publication', async () => {
		const t = setup();
		await t.router.discover(route);
		await t.tick();
		t.github.currentRun = { ...run(), status: 'completed', conclusion: 'failure' };
		t.advance();
		await t.tick();
		expect((await t.journal.get('11:44:scoop'))?.state).toBe('failed');
	});
	test('newer dispatched version prevents delayed older work and release recreation', async () => {
		const t = setup();
		await t.router.discover(route);
		await t.journal.advance(route.id, 'v2.1.0');
		await t.tick();
		expect(t.github.dispatches).toBe(0);
		t.github.value = { ...release(), id: 777 };
		await t.router.discover(route);
		expect(t.journal.entries.size).toBe(1);
	});
	test('v1 releases never dispatch', async () => {
		const t = setup();
		t.github.value = { ...release(), tag: 'v1.18.0' };
		await t.router.discover(route);
		expect(t.journal.entries.size).toBe(0);
	});
});

test('changing a configured route cannot redirect pending work', async () => {
	const t = setup();
	await t.router.discover(route);
	const operation = await t.journal.get('11:44:scoop');
	if (!operation) throw new Error('Missing operation');
	await t.router.tick({ ...route, destination: { id: 99, name: 'kjanat/another' } }, operation);
	expect((await t.journal.get('11:44:scoop'))?.state).toBe('failed');
	expect(t.github.dispatches).toBe(0);
});

test('a successful manual rerun recovers the same downstream operation', async () => {
	const t = setup();
	await t.router.discover(route);
	await t.tick();
	t.github.currentRun = { ...run(), status: 'completed', conclusion: 'failure' };
	t.advance();
	await t.tick();
	expect((await t.journal.get('11:44:scoop'))?.state).toBe('failed');
	t.github.currentRun = { ...run(), status: 'completed', conclusion: 'success' };
	t.advance();
	await t.tick();
	expect((await t.journal.get('11:44:scoop'))?.state).toBe('succeeded');
	expect(t.github.dispatches).toBe(1);
});
test('failed-run recovery window cannot extend forever', async () => {
	const t = setup();
	await t.router.discover(route);
	await t.tick();
	t.github.currentRun = { ...run(), status: 'completed', conclusion: 'failure' };
	t.advance();
	await t.tick();
	t.advance(8 * 24 * 60 * 60_000);
	t.github.currentRun = { ...run(), status: 'completed', conclusion: 'success' };
	await t.tick();
	expect((await t.journal.get('11:44:scoop'))?.state).toBe('failed');
});
