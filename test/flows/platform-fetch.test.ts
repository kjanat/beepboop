import { afterEach, expect, spyOn, test } from 'bun:test';
import type { World } from '@root/test/support/world';
import { eachWorld } from '@root/test/support/world';
import { Effect } from 'effect';
import { applicationLayer } from '@/automation/service';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import { githubOutage } from '@/server/github-status.ts';

let world: World;
eachWorld(created => {
	world = created;
});

let restore: (() => void) | undefined;
afterEach(() => {
	restore?.();
	restore = undefined;
});

const summary = {
	components: [{ name: 'Actions', status: 'major_outage', group: false }],
	incidents: [],
};

function workerdFetch(): { input: unknown; init: unknown }[] {
	const calls: { input: unknown; init: unknown }[] = [];
	const strict = function(this: unknown, input: unknown, init: unknown) {
		if (this !== undefined && this !== globalThis) {
			throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
		}
		calls.push({ input, init });
		return Promise.resolve(Response.json(summary));
	};
	const spy = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(strict, { preconnect: fetch.preconnect }));
	restore = () => spy.mockRestore();
	return calls;
}

test('a stored platform fetch forwards its input and options when called as a method', async () => {
	const calls = workerdFetch();
	const holder: { transport: Fetcher } = { transport: platformFetch };
	const init = { signal: new AbortController().signal };
	const response = await holder.transport('https://www.githubstatus.com/api/v2/summary.json', init);
	expect(await response.json()).toEqual(summary);
	expect(calls).toHaveLength(1);
	expect(calls[0]?.input).toBe('https://www.githubstatus.com/api/v2/summary.json');
	expect(calls[0]?.init).toBe(init);
});

test('the global fetch stored on an object fails when called as a method', () => {
	workerdFetch();
	const holder: { transport: Fetcher } = { transport: globalThis.fetch };
	expect(() => holder.transport('https://www.githubstatus.com/api/v2/summary.json')).toThrow('Illegal invocation');
});

test('the dashboard reads GitHub status through the default application transport', async () => {
	const calls = workerdFetch();
	const outage = await Effect.runPromise(githubOutage.pipe(Effect.provide(applicationLayer(world.env))));
	expect(outage?.description).toBe('GitHub reports problems with Actions');
	expect(calls.map(call => call.input)).toEqual(['https://www.githubstatus.com/api/v2/summary.json']);
});
