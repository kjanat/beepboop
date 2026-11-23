import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { bearer } from '@root/test/support/http.ts';
import { npmManifest, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { adminSubject, eachWorld, origin } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect, Schema } from 'effect';
import type { HTMLDetailsElement } from 'happy-dom';
import { Window } from 'happy-dom';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import { loaders } from '@/server/loaders';

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = mutableStruct({
	default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
});
const browser: { gates(details: HTMLDetailsElement): Effect.Effect<void, unknown> } = await import(
	new URL('../../src/ui/browser/gates.ts', import.meta.url).href
);

let world: World;
let window: Window;
const globals = [
	'document',
	'HTMLElement',
	'HTMLFormElement',
	'HTMLTableElement',
	'HTMLTableSectionElement',
	'HTMLButtonElement',
] as const;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
eachWorld(created => {
	world = created;
});
beforeEach(async () => {
	window = new Window({ url: `${origin}/repositories` });
	for (const key of globals) {
		descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
	}
	const cookie = await world.adminCookie();
	spyOn(globalThis, 'fetch').mockImplementation(Object.assign((input: string | URL | Request, init?: RequestInit) => {
		if (typeof input === 'string' && input.startsWith('/')) {
			return world.handle(
				new Request(new URL(input, origin), {
					...init,
					headers: { ...init?.headers, Cookie: cookie, Origin: origin },
				}),
			);
		}
		return world.network.fetch(input, init);
	}, { preconnect: fetch.preconnect }));
});
afterEach(async () => {
	await window.happyDOM.close();
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	descriptors.clear();
});

function rows(details: HTMLDetailsElement) {
	return [...details.querySelectorAll('tbody tr')].map(row =>
		[...row.querySelectorAll('td')].map(cell => {
			const badge = cell.querySelector('.badge');
			return badge ? `${badge.textContent}${badge.getAttribute('title') ? ' (titled)' : ''}` : cell.textContent;
		})
	);
}

async function settled(check: () => boolean) {
	for (let attempt = 0; attempt < 200 && !check(); attempt++) await Bun.sleep(1);
}

test('the repository page lists the release gates of a stream and switches one off and on again', async () => {
	const repository = widget(world.github, { approval: 'push' });
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const raised = world.github.push(
		repository,
		{ 'package.json': npmManifest('widget', '1.1.0', { license: undefined }) },
		'Release 1.1.0',
	);
	repository.checks.set(raised.sha, [{ name: 'test', status: 'in_progress', conclusion: null, runId: 1 }]);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);

	const data = await world.run(loaders.repositories({ env: world.env, actor: adminSubject }));
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Repositories.astro'));
	const container = await experimental_AstroContainer.create();
	window.document.body.innerHTML = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: { data },
		request: new Request(`${origin}/repositories`),
	});
	const details = window.document.querySelector('details[data-gates]');
	if (!(details instanceof window.HTMLDetailsElement)) throw new Error('Expected a gate list');
	expect(details.querySelector('summary')?.textContent?.trim()).toBe('Release gates: main');
	await Effect.runPromise(browser.gates(details));
	expect(details.querySelector('table')?.hidden).toBe(true);

	details.open = true;
	details.dispatchEvent(new window.Event('toggle'));
	await settled(() => details.querySelectorAll('tbody tr').length > 0);
	expect(details.querySelector('.gate-commit')?.textContent).toBe(`Commit ${raised.sha.slice(0, 7)} · 1.1.0`);
	expect(rows(details)).toEqual([
		['commit signature', 'verified', 'Switch off'],
		['check test', 'running', 'Switch off'],
		['package metadata', 'incomplete (titled)', 'Switch off'],
	]);
	expect(details.querySelectorAll('tbody tr')[2]?.querySelector('.badge')?.getAttribute('title')).toBe(
		'widget (package.json) lacks license',
	);

	const off = details.querySelector('button[aria-label="Switch off check test"]');
	if (!(off instanceof window.HTMLButtonElement)) throw new Error('Expected a switch');
	off.click();
	await settled(() => rows(details)[1]?.[1] !== 'running');
	expect(rows(details)[1]).toEqual(['check test', 'off (titled)', 'Switch on']);
	expect(details.querySelectorAll('tbody tr')[1]?.querySelector('.badge')?.getAttribute('title')).toMatch(
		/^Switched off by .+ on \d{4}-\d\d-\d\dT.+Z\. Gate: running$/,
	);

	const on = details.querySelector('button[aria-label="Switch on check test"]');
	if (!(on instanceof window.HTMLButtonElement)) throw new Error('Expected a switch');
	on.click();
	await settled(() => rows(details)[1]?.[2] === 'Switch off');
	expect(rows(details)[1]).toEqual(['check test', 'running', 'Switch off']);
}, 60_000);
