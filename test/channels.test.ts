import { parseConfiguration } from '@/config.ts';
import { dashboard } from '@/dashboard.ts';
import { compareVersions, semver } from '@/model.ts';
import { Router } from '@/router.ts';
import { expect, test } from 'bun:test';
import { configuration, FakeGitHub, MemoryJournal, route } from './fixtures.ts';

test('SemVer precedence includes numeric prereleases and ignores build metadata', () => {
	const values = [
		'0.1.0-alpha',
		'0.1.0-alpha.1',
		'0.1.0-alpha.2',
		'0.1.0-alpha.10',
		'0.1.0-beta',
		'0.1.0-rc.1',
		'0.1.0',
		'0.2.0',
	];
	for (let i = 1; i < values.length; i++) {
		expect(compareVersions(values[i - 1] ?? '', values[i] ?? '')).toBe(-1);
	}
	expect(compareVersions('v0.1.0+build.1', '0.1.0+build.2')).toBe(0);
	for (const value of ['1.0.0-01', '1.0.0-a..b', '01.0.0', '1.0.0-', '1.0.0+']) {
		expect(() => semver(value)).toThrow();
	}
});

test('defaults preserve serialized legacy route identity', () => {
	expect(JSON.stringify(parseConfiguration(configuration).routes[0])).toBe(JSON.stringify(route));
});

test('observation completes with no downstream dispatch', async () => {
	const journal = new MemoryJournal();
	const github = new FakeGitHub();
	const router = new Router(journal, github, () => 1_000_000);
	const observation = { ...route, mode: 'observe' as const };
	await router.discover(observation);
	const operation = (await journal.all())[0];
	if (!operation) throw new Error('Missing operation');
	await router.tick(observation, operation);
	expect((await journal.all())[0]?.state).toBe('succeeded');
	expect(github.dispatches).toBe(0);
});

test('disabled routes never discover or dispatch', async () => {
	const journal = new MemoryJournal();
	const github = new FakeGitHub();
	await new Router(journal, github).discover({ ...route, enabled: false });
	expect(await journal.all()).toEqual([]);
	expect(github.dispatches).toBe(0);
});

test('dashboard escapes labels and describes disabled routes', async () => {
	const response = dashboard(
		{ ...configuration, routes: [{ ...route, enabled: false, id: '<script>alert(1)</script>' }] },
		[],
		[],
	);
	const html = await response.text();
	expect(html).not.toContain('<script>');
	expect(html).toContain('&lt;script&gt;');
	expect(html).toContain('Disabled');
	expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
});
