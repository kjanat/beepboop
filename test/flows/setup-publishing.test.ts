import { expect, test } from 'bun:test';
import { bearer } from '@root/test/support/http.ts';
import { applySetup, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { Automation } from '@/automation/service';

let world: World;
eachWorld(created => {
	world = created;
});

const files = {
	'Cargo.toml': '[package]\nname = "tool"\nversion = "0.1.0"\nlicense = "MIT"\n',
	'src/lib.rs': '',
	'.github/workflows/publish.yml': `on: { push: { tags: ['v[0-9]*'] } }
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions: { id-token: write }
    steps:
      - uses: rust-lang/crates-io-auth-action@v1
      - run: cargo publish
        env:
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_TOKEN }}
`,
};

test.each(['crates-io', 'release-cargo'])(
	'setup preview and apply use installation permissions and the Worker vault (%s)',
	async alias => {
		const repository = world.github.create('octo/tool', files);
		const api = bearer(world, await world.cliSession());
		await world.run(Effect.gen(function*() {
			const service = yield* Automation;
			yield* service.vault().replace(alias, 'fixture-owner-token', 'test');
			if (alias !== 'crates-io') {
				yield* service.vault().grant({
					id: 'fixture-cargo-grant',
					alias,
					repository: repository.name,
					repositoryId: repository.id,
					operation: 'publish',
					workflow: 'publish.yml',
					ref: 'refs/tags/v*',
					delivery: 'environment',
					environment: 'release',
					secretName: 'CARGO_TOKEN',
				}, 'test');
			}
		}));
		const permissions: unknown[] = [];
		world.network.serve('api.github.com', async request => {
			const path = new URL(request.url).pathname;
			if (path.endsWith('/access_tokens')) {
				const body = await request.clone().json() as { permissions?: unknown };
				permissions.push(body.permissions);
			}
			if (path.endsWith('/environments/release')) return Response.json({ name: 'release' });
			if (path.endsWith('/environments/release/secrets/CARGO_TOKEN')) return Response.json({ name: 'CARGO_TOKEN' });
			return world.github.handle(request);
		});
		let registryChecks = 0, publisherChecks = 0;
		world.network.serve('crates.io', request => {
			const path = new URL(request.url).pathname;
			if (path.includes('/trusted_publishing/')) {
				publisherChecks++;
				expect(request.headers.get('Authorization')).toBe('Bearer fixture-owner-token');
				return Response.json({
					github_configs: [{
						crate: 'tool',
						repository_owner: 'octo',
						repository_name: 'tool',
						workflow_filename: 'publish.yml',
						environment: 'release',
					}],
					meta: { next_page: null },
				});
			}
			registryChecks++;
			return Response.json({ crate: { max_stable_version: '0.1.0' } });
		});
		const plan = await previewSetup(api, repository.name);
		expect(plan.publishingChecks?.length).toBeGreaterThan(0);
		expect(plan.publishingChecks?.every(check => check.status === 'passed')).toBe(true);
		expect(permissions).toContainEqual({
			contents: 'read',
			actions: 'read',
			secrets: 'read',
			variables: 'read',
			environments: 'read',
		});
		expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
		expect(registryChecks).toBeGreaterThanOrEqual(2);
		expect(publisherChecks).toBeGreaterThanOrEqual(2);
		expect(repository.pulls[0]?.body).toContain(
			'has a trusted publisher for tool matching octo/tool, publish.yml and environment release',
		);
		expect(JSON.stringify(plan)).not.toContain('fixture-owner-token');
		expect(repository.pulls[0]?.body).not.toContain('fixture-owner-token');
	},
);

test('setup rechecks registry state and rejects applying a stale readiness proposal', async () => {
	const repository = world.github.create('octo/tool', {
		...files,
		'.github/workflows/publish.yml': files['.github/workflows/publish.yml'].replace('    environment: release\n', '')
			.replace('        env:\n          CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}\n', ''),
	});
	const api = bearer(world, await world.cliSession());
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const plan = await previewSetup(api, repository.name);
	expect(plan.publishingChecks?.some(check => check.message.includes('returned 404'))).toBe(true);
	world.network.serve('crates.io', () => new Response(null, { status: 503 }));
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(409);
	expect(repository.pulls).toHaveLength(0);
});
