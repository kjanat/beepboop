import { afterEach, expect, spyOn, test } from 'bun:test';
import type { Fetcher } from '@/automation/managers/registry';
import { platformFetch } from '@/automation/managers/registry';

let restore: (() => void) | undefined;
afterEach(() => {
	restore?.();
	restore = undefined;
});

function workerdFetch(): void {
	const strict = function(this: unknown) {
		if (this !== undefined && this !== globalThis) {
			throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
		}
		return Promise.resolve(Response.json({ ok: true }));
	};
	const spy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(strict, { preconnect: fetch.preconnect }));
	restore = () => spy.mockRestore();
}

test('a stored platform fetch can be called as a method, as Workers requires of fetch', async () => {
	workerdFetch();
	const holder: { transport: Fetcher } = { transport: platformFetch };
	const response = await holder.transport('https://www.githubstatus.com/api/v2/summary.json');
	expect(await response.json()).toEqual({ ok: true });
});

test('the global fetch stored on an object fails when called as a method', () => {
	workerdFetch();
	const holder: { transport: Fetcher } = { transport: globalThis.fetch };
	expect(() => holder.transport('https://www.githubstatus.com/api/v2/summary.json')).toThrow('Illegal invocation');
});
