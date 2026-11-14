import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function start(page: Page) {
	await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
	await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
	await page.goto('/polling');
	await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
async function visibility(page: Page, hidden: boolean) {
	await page.evaluate(value => {
		Object.defineProperty(document, 'hidden', { value, configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	}, hidden);
}
const snapshot = (updatedAt: number) => [{
	id: 'run',
	repositoryId: 1,
	repository: 'o/r',
	stream: 'release',
	operation: 'publish',
	state: 'running',
	sourceSha: 'a'.repeat(40),
	updatedAt,
}];

test('slow snapshots stay serial and the next poll waits for completion', async ({ page }) => {
	const requests: Route[] = [];
	await page.route('**/api/executions?repository=o%2Fr', route => {
		requests.push(route);
	});
	await start(page);
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(1);
	await page.clock.runFor(15_000);
	expect(requests).toHaveLength(1);
	const first = requests[0];
	if (!first) throw new Error('Missing polling request');
	await Promise.all([
		page.waitForEvent('requestfinished', request => request === first.request()),
		first.fulfill({ json: snapshot(100) }),
	]);
	await page.evaluate(() => Promise.resolve());
	await page.clock.runFor(4999);
	expect(requests).toHaveLength(1);
	await page.clock.runFor(1);
	await expect.poll(() => requests.length).toBe(2);
});

test('timed out and failed requests release the polling slot for retries', async ({ page }) => {
	const requests: Route[] = [];
	const failures: string[] = [];
	page.on('requestfailed', request => {
		if (request.url().includes('/api/executions')) failures.push(request.url());
	});
	await page.route('**/api/executions**', route => {
		requests.push(route);
	});
	await start(page);
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(1);
	await page.clock.runFor(20_000);
	await expect.poll(() => failures.length).toBe(1);
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(2);
	const retry = requests[1];
	if (!retry) throw new Error('Missing polling request');
	await Promise.all([
		page.waitForEvent('requestfinished', request => request === retry.request()),
		retry.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }),
	]);
	await page.evaluate(() => Promise.resolve());
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(3);
	const recovered = requests[2];
	if (!recovered) throw new Error('Missing polling request');
	await Promise.all([
		page.waitForEvent('requestfinished', request => request === recovered.request()),
		recovered.fulfill({ json: snapshot(100) }),
	]);
	await page.evaluate(() => Promise.resolve());
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(4);
});

test('hidden pages and pagehide cancel polling, and returning pages resume it', async ({ page }) => {
	const requests: Route[] = [];
	let failures = 0;
	page.on('requestfailed', request => {
		if (request.url().includes('/api/executions')) failures++;
	});
	await page.route('**/api/executions**', route => {
		requests.push(route);
	});
	await start(page);
	await visibility(page, true);
	await page.clock.runFor(30_000);
	expect(requests).toHaveLength(0);
	await visibility(page, false);
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(1);
	await visibility(page, true);
	await expect.poll(() => failures).toBe(1);
	await page.clock.runFor(30_000);
	expect(requests).toHaveLength(1);
	await visibility(page, false);
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(2);
	await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
	await expect.poll(() => failures).toBe(2);
	await page.clock.runFor(30_000);
	expect(requests).toHaveLength(2);
	await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
	await page.clock.runFor(5000);
	await expect.poll(() => requests.length).toBe(3);
});

test('only a snapshot newer than the rendered page reloads it', async ({ page }) => {
	let polls = 0, navigations = 0;
	page.on('framenavigated', frame => {
		if (frame === page.mainFrame()) navigations++;
	});
	await page.route('**/api/executions**', route => route.fulfill({ json: snapshot([99, 100, 101][polls++] ?? 100) }));
	await start(page);
	await page.clock.runFor(5000);
	await expect.poll(() => polls).toBe(1);
	expect(navigations).toBe(1);
	await page.clock.runFor(5000);
	await expect.poll(() => polls).toBe(2);
	expect(navigations).toBe(1);
	await page.clock.runFor(5000);
	await expect.poll(() => navigations).toBe(2);
});
