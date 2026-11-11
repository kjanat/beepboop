import { expect, test } from 'bun:test';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { RepositoryGateway } from '@/automation/github';

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
