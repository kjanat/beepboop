import { expect, test } from 'bun:test';
import { appSlug } from '@root/test/support/github.ts';
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
          CARGO_REGISTRY_TOKEN: \${{ secrets.cargo_token }}
`,
};

test.each(['crates-io', 'release-cargo', 'reusable-cargo'])(
	'setup preview and apply use installation permissions and the Worker vault (%s)',
	async alias => {
		const reusable = alias === 'reusable-cargo';
		const secretName = reusable ? 'REGISTRY_TOKEN' : 'CARGO_TOKEN';
		const repository = world.github.create(
			'octo/tool',
			reusable
				? {
					...files,
					'.github/workflows/publish.yml': `on: { push: { tags: ['v[0-9]*'] } }
jobs:
  publish:
    permissions: { id-token: write }
    uses: ./.github/workflows/cargo.yml
    secrets:
      registry_token: \${{ secrets.OWNER_TOKEN }}
`,
					'.github/workflows/cargo.yml': files['.github/workflows/publish.yml']
						.replace(
							"on: { push: { tags: ['v[0-9]*'] } }",
							'on: { workflow_call: { secrets: { registry_token: { required: true } } } }',
						)
						.replace('secrets.cargo_token', 'secrets.registry_token'),
				}
				: files,
		);
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
					secretName,
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
			if (path.endsWith(`/environments/release/secrets/${secretName}`)) return Response.json({ name: secretName });
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
			.replace('        env:\n          CARGO_REGISTRY_TOKEN: ${{ secrets.cargo_token }}\n', ''),
	});
	const api = bearer(world, await world.cliSession());
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const plan = await previewSetup(api, repository.name);
	expect(plan.publishingChecks?.some(check => check.message.includes('returned 404'))).toBe(true);
	world.network.serve('crates.io', () => new Response(null, { status: 503 }));
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(409);
	expect(repository.pulls).toHaveLength(0);
});

test('missing installation permissions are reported as App access failures before requesting an elevated token', async () => {
	const repository = world.github.create('octo/tool', files);
	const api = bearer(world, await world.cliSession());
	let rejectedTokenRequests = 0;
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		if (path.endsWith('/access_tokens')) {
			const body = await request.clone().json() as { permissions?: Record<string, string> };
			if (body.permissions?.secrets) rejectedTokenRequests++;
		}
		const response = await world.github.handle(request);
		if (path.endsWith('/installation') && response.ok) {
			return Response.json({
				...await response.json() as object,
				permissions: { contents: 'write', actions: 'write', pull_requests: 'write', workflows: 'write' },
			});
		}
		return response;
	});
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const plan = await previewSetup(api, repository.name);
	const failed = plan.publishingChecks?.filter(check => check.status === 'failed') ?? [];
	expect(failed).toHaveLength(1);
	expect(failed[0]?.message).toContain('GitHub App installation lacks required permissions');
	for (const permission of ['secrets: read', 'variables: read', 'environments: read']) {
		expect(failed[0]?.message).toContain(permission);
	}
	expect(failed[0]?.message).toContain('approve the installation update');
	expect(failed[0]?.message).toContain(`https://github.com/apps/${appSlug}`);
	expect(failed[0]?.message).not.toContain('Publishing configuration check failed');
	expect(rejectedTokenRequests).toBe(0);
	expect(plan.notes.some(note => note.includes('GitHub App installation lacks'))).toBe(true);
	expect(plan.publishingChecks?.some(check => check.message.includes('returned 404'))).toBe(true);
});

test('missing workflow-write permission preserves safe setup previews without swallowing owner failures', async () => {
	const repository = world.github.create('octo/tool', files);
	const api = bearer(world, await world.cliSession());
	let wrongOwner = false;
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		if (path.endsWith('/environments/release')) return Response.json({ name: 'release' });
		if (path.endsWith('/secrets/CARGO_TOKEN')) return Response.json({ name: 'CARGO_TOKEN' });
		const response = await world.github.handle(request);
		if (path.endsWith('/installation') && response.ok) {
			const installation = await response.json() as { account: { id: number; login: string } };
			return Response.json({
				...installation,
				...(wrongOwner ? { account: { ...installation.account, id: installation.account.id + 1 } } : {}),
				permissions: {
					contents: 'write',
					actions: 'write',
					pull_requests: 'write',
					secrets: 'read',
					variables: 'read',
					environments: 'read',
				},
			});
		}
		return response;
	});
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const canEdit = () => world.run(Effect.gen(function*() {
		const service = yield* Automation;
		return yield* service.gateway.canEditWorkflows(repository.name, repository.id);
	}));
	expect(await canEdit()).toBe(false);
	const plan = await previewSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
	const choices = {
		streams: [{
			name: 'main',
			packages: ['pkg:cargo/tool'],
			required: ['pkg:cargo/tool'],
			versioning: 'workspace',
			promote: {
				file: 'managed.yml',
				job: 'publish',
				triggers: 'review',
				commands: 'cargo publish',
				publicationSteps: {},
			},
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	expect(preview.status).toBe(200);
	const blocked = preview.body as { blockers: string[] };
	expect(blocked.blockers.some(message => message.includes('Workflows: write'))).toBe(true);
	expect(blocked.blockers.some(message => message.includes(`https://github.com/apps/${appSlug}`))).toBe(true);
	wrongOwner = true;
	await expect(canEdit()).rejects.toThrow('Owner mismatch');
});
