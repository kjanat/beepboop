import { expect, test } from 'bun:test';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { gitHubRequest, RepositoryGateway } from '@/automation/github';

let world: World;
eachWorld(created => {
	world = created;
});

function oid(index: number): string {
	return index.toString(16).padStart(40, '0');
}

test('tag discovery reads 150 annotated and lightweight tags in two GitHub requests', async () => {
	const repository = widget(world.github, { configured: false });
	const commit = world.github.head(repository);
	const expected = Array.from({ length: 150 }, (_, index) => {
		const name = `v1.0.${index}`;
		if (index % 2 === 0) {
			world.github.recordTag(repository, name, oid(index + 1), commit, true);
			return { name, oid: oid(index + 1), commit };
		}
		repository.refs.set(`tags/${name}`, commit);
		return { name, oid: commit, commit };
	});
	const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID));
	const mark = world.network.mark();
	const refs = await Effect.runPromise(gateway.tagRefs(repository.name, repository.id));
	expect(refs).toEqual(expected);
	const paths = world.network.since(mark).map(exchange => `${exchange.method} ${new URL(exchange.url).pathname}`);
	expect(paths.filter(path => path === 'POST /graphql')).toHaveLength(2);
	expect(paths.filter(path => path.includes('/git/'))).toEqual([]);
});

test('tag discovery refuses a tag that resolves to something other than a commit', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.recordTag(repository, 'v1.0.0', oid(1), oid(2), true);
	const tagged = repository.tagObjects.get(oid(1));
	if (!tagged) throw new Error('No tag object');
	tagged.targetType = 'Tree';
	const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID));
	const exit = await Effect.runPromiseExit(gateway.tagRefs(repository.name, repository.id));
	expect(JSON.stringify(exit)).toContain('Tag does not resolve to a commit');
});

for (const endCursor of [null, 'same']) {
	test(`tag discovery stops when the next page cursor is ${endCursor ?? 'missing'}`, async () => {
		const repository = widget(world.github, { configured: false });
		let pages = 0;
		world.network.serve('api.github.com', request => {
			if (new URL(request.url).pathname !== '/graphql') return world.github.handle(request);
			pages += 1;
			return Response.json({
				data: { repository: { refs: { pageInfo: { hasNextPage: true, endCursor }, nodes: [] } } },
			});
		});
		const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID));
		const exit = await Effect.runPromiseExit(gateway.tagRefs(repository.name, repository.id));
		expect(JSON.stringify(exit)).toContain('Tag discovery cursor did not advance');
		expect(pages).toBe(endCursor === null ? 1 : 2);
	});
}

test('read-only tag queries retry server errors while mutation POSTs remain single-attempt', async () => {
	const repository = widget(world.github, { configured: false });
	let queries = 0;
	world.network.serve('api.github.com', request => {
		if (new URL(request.url).pathname === '/graphql' && ++queries === 1) {
			return new Response('Temporary failure', { status: 503 });
		}
		return world.github.handle(request);
	});
	const gateway = new RepositoryGateway(world.env, Number(world.env.OWNER_ID));
	expect(await Effect.runPromise(gateway.tagRefs(repository.name, repository.id))).toEqual([]);
	expect(queries).toBe(2);
	let mutations = 0;
	const result = await Effect.runPromiseExit(gitHubRequest(
		async () => {
			mutations++;
			return new Response('Unavailable', { status: 503 });
		},
		'/graphql',
		'fixture',
		'POST',
		{ query: 'mutation { test }' },
	));
	expect(result._tag).toBe('Failure');
	expect(mutations).toBe(1);
});

test.each([
	{ errors: [{ message: 'Query rate limit exceeded', type: 'RATE_LIMITED' }], data: null },
	{ errors: [{ message: 'Repository unavailable', type: 'NOT_FOUND' }] },
	{
		errors: [{ message: 'Incomplete tag data' }],
		data: { repository: { refs: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } },
	},
])('GraphQL errors fail closed with their upstream explanation: %j', async answer => {
	const repository = widget(world.github, { configured: false });
	world.network.serve(
		'api.github.com',
		request => new URL(request.url).pathname === '/graphql' ? Response.json(answer) : world.github.handle(request),
	);
	const result = await Effect.runPromiseExit(
		new RepositoryGateway(world.env, Number(world.env.OWNER_ID)).tagRefs(repository.name, repository.id),
	);
	expect(result._tag).toBe('Failure');
	expect(JSON.stringify(result)).toContain(answer.errors[0]!.message);
	if ('type' in answer.errors[0]! && answer.errors[0].type === 'RATE_LIMITED') {
		expect(JSON.stringify(result)).toContain('retryAt');
	}
});

test.each([8, 9])('tag query peels %i annotated layers only within its supported depth', async depth => {
	const repository = widget(world.github, { configured: false });
	const commit = world.github.head(repository);
	for (let index = 0; index < depth; index++) {
		world.github.recordTag(
			repository,
			`layer-${index}`,
			oid(index + 1),
			index === depth - 1 ? commit : oid(index + 2),
			true,
		);
		if (index !== depth - 1) repository.tagObjects.get(oid(index + 1))!.targetType = 'Tag';
		if (index > 0) repository.refs.delete(`tags/layer-${index}`);
	}
	const result = await Effect.runPromiseExit(
		new RepositoryGateway(world.env, Number(world.env.OWNER_ID)).tagRefs(repository.name, repository.id),
	);
	if (depth === 8) {
		expect(result._tag).toBe('Success');
		if (result._tag === 'Success') expect(result.value).toEqual([{ name: 'layer-0', oid: oid(1), commit }]);
	} else {
		expect(result._tag).toBe('Failure');
		expect(JSON.stringify(result)).toContain('Tag does not resolve to a commit');
	}
});

test.each([0, 100, 10_000, 10_001])('tag pagination handles %i tags at page and discovery boundaries', async count => {
	const repository = widget(world.github, { configured: false });
	const commit = world.github.head(repository);
	for (let index = 0; index < count; index++) repository.refs.set(`tags/v${index}`, commit);
	let pages = 0;
	world.network.serve('api.github.com', request => {
		if (new URL(request.url).pathname === '/graphql') pages++;
		return world.github.handle(request);
	});
	const result = await Effect.runPromiseExit(
		new RepositoryGateway(world.env, Number(world.env.OWNER_ID)).tagRefs(repository.name, repository.id),
	);
	expect(pages).toBe(Math.max(1, Math.min(100, Math.ceil(count / 100))));
	if (count <= 10_000) {
		expect(result._tag).toBe('Success');
		if (result._tag === 'Success') expect(result.value).toHaveLength(count);
	} else {
		expect(result._tag).toBe('Failure');
		expect(JSON.stringify(result)).toContain('Tag discovery limit exceeded');
	}
});

test.each([
	{ data: null },
	{ data: { repository: null } },
	{
		data: {
			repository: {
				refs: { nodes: [{ name: 'broken', target: null }], pageInfo: { hasNextPage: false, endCursor: null } },
			},
		},
	},
])('tag discovery rejects missing or malformed data: %j', async answer => {
	const repository = widget(world.github, { configured: false });
	world.network.serve(
		'api.github.com',
		request => new URL(request.url).pathname === '/graphql' ? Response.json(answer) : world.github.handle(request),
	);
	const result = await Effect.runPromiseExit(
		new RepositoryGateway(world.env, Number(world.env.OWNER_ID)).tagRefs(repository.name, repository.id),
	);
	expect(result._tag).toBe('Failure');
	expect(JSON.stringify(result)).toContain('missing or invalid repository/ref data');
});
