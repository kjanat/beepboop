import { expect, test } from 'bun:test';
import { discoveredWidget } from '@root/test/support/client.ts';
import type { Repository } from '@root/test/support/github.ts';
import { ownerId } from '@root/test/support/github.ts';
import type { Host } from '@root/test/support/network.ts';
import { widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { virtualTime } from '@root/test/support/time.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Option } from 'effect';
import { RepositoryGateway } from '@/automation/gateway.ts';
import { Automation } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';
import { rawFile } from '@/github/raw.ts';

let world: World;
eachWorld(created => {
	world = created;
});

function fileReads(mark: number): { contents: string[]; raw: string[] } {
	const exchanges = world.network.since(mark);
	return {
		contents: exchanges.flatMap(exchange => {
			const url = new URL(exchange.url);
			const [, path] = url.pathname.split('/contents/');
			return exchange.host === 'api.github.com' && path !== undefined
				? [`${exchange.status} ${url.searchParams.get('ref')} ${decodeURIComponent(path)}`]
				: [];
		}).sort(),
		raw: exchanges.flatMap(exchange => {
			if (exchange.host !== 'raw.githubusercontent.com') return [];
			const [, , commit, ...path] = new URL(exchange.url).pathname.slice(1).split('/').map(decodeURIComponent);
			return [`${exchange.status} ${commit} ${path.join('/')}`];
		}).sort(),
	};
}

function snapshot(repository: Repository) {
	return world.run(Automation.use(service => repositorySnapshot(service.gateway, repository.name, repository.id)));
}

function failingRaw(path: string, failure: Host): void {
	world.network.serve(
		'raw.githubusercontent.com',
		request => new URL(request.url).pathname.endsWith(`/${path}`) ? failure(request) : world.github.raw(request),
	);
}

test('refresh reads public repository files from raw.githubusercontent.com and private ones from the API', async () => {
	const repository = await discoveredWidget(world, await world.cliSession());
	const script = '.github/scripts/re lease#1.sh';
	const head = world.github.push(repository, { [script]: 'echo release\n' }, 'Add a release script').sha;
	const read = [
		'.github/beepboop.json',
		script,
		'.github/workflows/ci.yml',
		'.github/workflows/publish.yml',
		'README.md',
		'package.json',
	]
		.map(path => `200 ${head} ${path}`).sort();
	const service = await world.run(Automation);

	const publicMark = world.network.mark();
	const shared = await world.run(service.catalog.refresh(repository.name, repository.id));
	expect(fileReads(publicMark)).toEqual({ contents: [], raw: read });

	repository.private = true;
	const privateMark = world.network.mark();
	const hidden = await world.run(service.catalog.refresh(repository.name, repository.id));
	expect(fileReads(privateMark)).toEqual({ contents: read, raw: [] });
	expect(hidden.configuration).toEqual(shared.configuration);
	expect(hidden.inventory).toEqual(shared.inventory);
	expect(hidden.diagnostics).toEqual(shared.diagnostics);
});

for (
	const [name, status, failure] of [
		['a 503', 503, () => new Response('Service Unavailable', { status: 503 })],
		['a 404', 404, () => new Response('404: Not Found', { status: 404 })],
		['invalid UTF-8', 200, () => new Response(new Uint8Array([0xff, 0xfe]))],
		['a body over 1 MiB', 200, () => new Response('x'.repeat(1_048_577))],
		['a declared length over 1 MiB', 200, () => new Response('{}', { headers: { 'content-length': '1048577' } })],
	] satisfies [string, number, Host][]
) {
	test(`raw ${name} for an existing file falls back to the contents API`, async () => {
		const repository = widget(world.github);
		const head = world.github.head(repository);
		failingRaw('.github/beepboop.json', failure);
		const mark = world.network.mark();
		const read = await snapshot(repository);
		expect(read.files['.github/beepboop.json']).toBe(widgetConfiguration());
		const reads = fileReads(mark);
		expect(reads.contents).toEqual([`200 ${head} .github/beepboop.json`]);
		expect(reads.raw).toContain(`${status} ${head} .github/beepboop.json`);
	});
}

test('raw reads refuse a branch name without a request', async () => {
	const requested: string[] = [];
	const read = await Effect.runPromise(rawFile(
		async input => {
			requested.push(String(input));
			return new Response('{}');
		},
		'octo/widget',
		'main',
		'.github/beepboop.json',
	));
	expect(Option.isNone(read)).toBe(true);
	expect(requested).toEqual([]);
});

test('raw reads stop downloading a body without a length once it passes 1 MiB', async () => {
	let pulled = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (pulled >= 8 * 1_048_576) return controller.close();
			pulled += 65_536;
			controller.enqueue(new Uint8Array(65_536).fill(120));
		},
	});
	const read = await Effect.runPromise(
		rawFile(() => Promise.resolve(new Response(body)), 'octo/widget', 'a'.repeat(40), 'README.md'),
	);
	expect(Option.isNone(read)).toBe(true);
	expect(pulled).toBeLessThan(2 * 1_048_576);
});

test('a raw network error falls back to the contents API', async () => {
	const repository = widget(world.github);
	const head = world.github.head(repository);
	failingRaw('README.md', () => {
		throw new TypeError('connection reset');
	});
	const mark = world.network.mark();
	const read = await snapshot(repository);
	expect(read.files['README.md']).toBe('# widget\n');
	expect(fileReads(mark).contents).toEqual([`200 ${head} README.md`]);
});

test('a raw read that stalls for 10 seconds falls back to the contents API', async () => {
	const repository = widget(world.github);
	const head = world.github.head(repository);
	let aborted = false;
	failingRaw('README.md', request =>
		new Promise((_, reject) => {
			request.signal.addEventListener('abort', () => {
				aborted = true;
				reject(request.signal.reason);
			});
		}));
	const mark = world.network.mark();
	const read = await virtualTime(
		repositorySnapshot(new RepositoryGateway(world.env, ownerId), repository.name, repository.id),
	);
	expect(read.files['README.md']).toBe('# widget\n');
	expect(aborted).toBe(true);
	expect(fileReads(mark).contents).toEqual([`200 ${head} README.md`]);
});

test('a file absent from raw and from the contents API stays absent', async () => {
	const repository = widget(world.github);
	const head = world.github.head(repository);
	failingRaw('README.md', () => new Response('404: Not Found', { status: 404 }));
	world.network.serve('api.github.com', request =>
		new URL(request.url).pathname.endsWith('/contents/README.md')
			? Response.json({ message: 'Not Found' }, { status: 404 })
			: world.github.handle(request));
	const mark = world.network.mark();
	const read = await snapshot(repository);
	expect(Object.keys(read.files)).not.toContain('README.md');
	expect(read.files['.github/beepboop.json']).toBe(widgetConfiguration());
	const reads = fileReads(mark);
	expect(reads.contents).toEqual([`404 ${head} README.md`]);
	expect(reads.raw).toContain(`404 ${head} README.md`);
});
