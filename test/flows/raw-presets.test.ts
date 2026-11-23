import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { ownerId } from '@root/test/support/github.ts';
import type { Host } from '@root/test/support/network.ts';
import { jsonFile } from '@root/test/support/repositories.ts';
import { virtualTime } from '@root/test/support/time.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { RepositoryGateway } from '@/automation/github';
import { Automation } from '@/automation/service';

let world: World;
let presets: Repository;
const policy = { managers: ['npm'], streams: { main: { packages: ['pkg:npm/widget'] } } };
const lookups = [
	'api.github.com 200 /repos/octo/presets',
	'api.github.com 200 /repos/octo/presets/commits/main',
	'api.github.com 200 /repos/octo/presets/contents/release.json',
];
eachWorld(created => {
	world = created;
	presets = world.github.create('octo/presets', { 'release.json': jsonFile(policy) });
});

function load(reference = 'github>octo/presets:release') {
	return world.run(Automation.use(service => service.gateway.preset(reference)));
}

function exchanges(mark: number, host?: string): string[] {
	return world.network.since(mark).filter(exchange => host === undefined || exchange.host === host).map(exchange =>
		`${exchange.host} ${exchange.status} ${new URL(exchange.url).pathname}`
	);
}

function apiCalls(mark: number): string[] {
	return exchanges(mark, 'api.github.com').map(call => call.replace(/\/commits\/[^/]+$/, '/commits/main'));
}

function packet(line: string): string {
	return `${(line.length + 5).toString(16).padStart(4, '0')}${line}\n`;
}

function failing(host: string, failure: Host): () => number {
	let attempts = 0;
	world.network.serve(host, request => {
		attempts += 1;
		return failure(request);
	});
	return () => attempts;
}

test('a preset on the default branch loads from raw.githubusercontent.com without an API call', async () => {
	const head = world.github.head(presets);
	const mark = world.network.mark();
	expect(await load()).toEqual({ value: policy, sha: head });
	expect(exchanges(mark)).toEqual([
		'github.com 200 /octo/presets.git/git-upload-pack',
		`raw.githubusercontent.com 200 /octo/presets/${head}/release.json`,
	]);
});

test('a preset at a branch or an annotated tag loads from raw at the commit the ref names', async () => {
	const tagged = world.github.head(presets);
	world.github.recordTag(presets, 'v1', 'f'.repeat(40), tagged, true);
	presets.refs.set('heads/next', tagged);
	presets.refs.set('heads/next-2', world.github.push(presets, { 'other.json': '{}' }, 'Diverge').sha);
	const changed = { managers: ['cargo'] };
	const next = world.github.push(presets, { 'release.json': jsonFile(changed) }, 'Change the preset', 'next');
	const mark = world.network.mark();
	expect(await load('github>octo/presets:release#v1')).toEqual({ value: policy, sha: tagged });
	expect(await load('github>octo/presets:release#next')).toEqual({ value: changed, sha: next.sha });
	expect(exchanges(mark, 'api.github.com')).toEqual([]);
});

test('a preset pinned to a commit SHA loads from raw without a ref lookup', async () => {
	const head = world.github.head(presets);
	const mark = world.network.mark();
	expect(await load(`github>octo/presets:release#${head}`)).toEqual({ value: policy, sha: head });
	expect(exchanges(mark)).toEqual([`raw.githubusercontent.com 200 /octo/presets/${head}/release.json`]);
});

for (
	const [name, failure] of [
		['a 401', () => new Response('Repository not found.', { status: 401 })],
		['a 503', () => new Response('Service Unavailable', { status: 503 })],
		['a malformed packet length', () => new Response(`0zz\n${packet(`${world.github.head(presets)} HEAD`)}0000`)],
		['a reference past 64 KiB', () => {
			const filler = `${'0'.repeat(40)} refs/heads/${'x'.repeat(200)}`;
			const head = world.github.head(presets);
			return new Response(`${packet(filler).repeat(400)}${packet(`${head} HEAD`)}0000`);
		}],
		['a network error', () => {
			throw new TypeError('connection reset');
		}],
	] satisfies [string, Host][]
) {
	test(`ref discovery answering ${name} falls back to the API`, async () => {
		const attempts = failing('github.com', failure);
		const mark = world.network.mark();
		expect(await load()).toEqual({ value: policy, sha: world.github.head(presets) });
		expect(attempts()).toBe(1);
		expect(apiCalls(mark)).toEqual(lookups);
		expect(exchanges(mark, 'raw.githubusercontent.com')).toEqual([]);
	});
}

test('ref discovery falls back to the API when a branch and a tag share the name', async () => {
	const head = world.github.head(presets);
	presets.refs.set('heads/stable', head);
	presets.refs.set('tags/stable', head);
	const mark = world.network.mark();
	expect(await load('github>octo/presets:release#stable')).toEqual({ value: policy, sha: head });
	expect(exchanges(mark, 'github.com')).toEqual(['github.com 200 /octo/presets.git/git-upload-pack']);
	expect(apiCalls(mark)).toEqual(lookups);
});

test('ref discovery ignores a reference that the 64 KiB cut leaves as a shorter name', async () => {
	const head = world.github.head(presets);
	presets.refs.set('tags/v1', head);
	const filler = `${'0'.repeat(40)} refs/heads/${'x'.repeat(65_536 - 57 - 57)}`;
	const attempts = failing('github.com', () => new Response(`${packet(filler)}${packet(`${head} refs/tags/v10`)}0000`));
	const mark = world.network.mark();
	expect(await load('github>octo/presets:release#v1')).toEqual({ value: policy, sha: head });
	expect(attempts()).toBe(1);
	expect(apiCalls(mark)).toEqual(lookups);
});

test('ref discovery that stalls for 10 seconds falls back to the API', async () => {
	let aborted = false;
	const attempts = failing('github.com', request =>
		new Promise((_, reject) => {
			request.signal.addEventListener('abort', () => {
				aborted = true;
				reject(request.signal.reason);
			});
		}));
	const mark = world.network.mark();
	const loaded = await virtualTime(
		new RepositoryGateway(world.env, ownerId).preset('github>octo/presets:release'),
	);
	expect(loaded).toEqual({ value: policy, sha: world.github.head(presets) });
	expect([attempts(), aborted]).toEqual([1, true]);
	expect(apiCalls(mark)).toEqual(lookups);
});

for (
	const [name, failure] of [
		['a 503', () => new Response('Service Unavailable', { status: 503 })],
		['a 404', () => new Response('404: Not Found', { status: 404 })],
		['the target path of a symlink', () => new Response('presets/base.json')],
		['JSON that is not an object', () => new Response('["npm"]')],
	] satisfies [string, Host][]
) {
	test(`a raw preset read answering ${name} falls back to the API`, async () => {
		const attempts = failing('raw.githubusercontent.com', failure);
		const mark = world.network.mark();
		expect(await load()).toEqual({ value: policy, sha: world.github.head(presets) });
		expect(exchanges(mark, 'github.com')).toEqual(['github.com 200 /octo/presets.git/git-upload-pack']);
		expect(attempts()).toBe(1);
		expect(apiCalls(mark)).toEqual(lookups);
	});
}

test('a preset missing from raw and from the API stays missing', async () => {
	const mark = world.network.mark();
	const exit = await world.run(
		Automation.use(service => service.gateway.preset('github>octo/presets:absent')).pipe(Effect.flip),
	);
	expect(exit.message).toBe('Preset missing');
	const head = world.github.head(presets);
	expect(exchanges(mark, 'raw.githubusercontent.com')).toEqual([
		`raw.githubusercontent.com 404 /octo/presets/${head}/absent.json`,
	]);
	expect(exchanges(mark, 'api.github.com')).toContain(
		'api.github.com 404 /repos/octo/presets/contents/absent.json',
	);
});
