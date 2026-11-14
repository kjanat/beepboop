import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { discover } from '@/automation/managers';
import { previewSetup, setupBody } from '@/automation/setup';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { PublishingAccess } from '@/automation/setup-publishing';
import { streamSummary } from '@/automation/setup-summary';
import type { Snapshot } from '@/automation/types';

test('observed release publishing is described without inventing tag triggers or version PRs', async () => {
	const files = {
		'package.json': JSON.stringify({ name: 'example', version: '1.0.0', private: false }),
		'.github/workflows/publish.yml':
			'on: { release: { types: [published] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n',
	};
	const snapshot: Snapshot = {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
	const plan = await Effect.runPromise(previewSetup(
		snapshot,
		discover(snapshot),
		{
			streams: [{
				name: 'main',
				packages: ['pkg:npm/example'],
				required: ['pkg:npm/example'],
				versioning: 'workspace',
				observe: [{ name: 'publish', file: 'publish.yml', ref: 'refs/tags/*', publications: ['pkg:npm/example'] }],
			}],
		},
		{ head: null },
	));
	const stream = plan.choices.streams[0];
	if (!stream) throw new Error('Missing release group');
	const summary = streamSummary(stream, plan).join('\n');
	expect(summary).toContain('publishes example to npm');
	expect(summary).not.toContain('Tags matching');
	expect(summary).not.toContain('opens the version PR');
	const body = setupBody(plan, { branch: 'automation/onboarding', defaultBranch: 'main' });
	expect(body).toContain('observes the existing publishing workflows');
	expect(body).toContain('Publication: observes `publish.yml`');
	expect(body).not.toContain('has no publishing workflow');
});

function cargoSnapshot(): Snapshot {
	const names = ['tool-error', 'tool-core', 'tool-output', 'tool-complete', 'tool'];
	const files: Record<string, string> = {
		'Cargo.toml': `[workspace]
members = ["crates/*"]
[workspace.package]
version = "0.1.0"
license = "MIT"
repository = "https://github.com/example/tool"
description = "Example CLI"
readme = "README.md"
`,
		'LICENSE': 'MIT license text',
		'README.md': '# Example',
		'.github/workflows/publish.yml': `on:
  push:
    tags: ["v[0-9]*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - uses: rust-lang/crates-io-auth-action@v1
        id: auth
      - run: cargo publish --workspace --locked --all-features --registry crates-io
        env:
          CARGO_REGISTRY_TOKEN: \${{ steps.auth.outputs.token }}
`,
	};
	for (const name of names) {
		files[`crates/${name}/Cargo.toml`] = `[package]
name = "${name}"
version.workspace = true
license.workspace = true
repository.workspace = true
description.workspace = true
readme.workspace = true
`;
		files[`crates/${name}/src/lib.rs`] = '';
	}
	return {
		repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
}

test('observed Cargo adoption distinguishes warnings, readiness, and tag filters while preserving the workspace', async () => {
	const snapshot = cargoSnapshot();
	const inventory = discover(snapshot);
	const draft = await Effect.runPromise(
		previewSetup(snapshot, inventory, undefined, { head: null, publishing: missingCrates() }),
	);
	const plan = await Effect.runPromise(parseSetupPlan(JSON.parse(JSON.stringify(draft))));
	const stream = plan.choices.streams[0];
	if (!stream) throw new Error('Missing Cargo stream');
	expect(plan.choices.streams).toHaveLength(1);
	expect([...stream.packages].sort()).toEqual(
		['tool-error', 'tool-core', 'tool-output', 'tool-complete', 'tool'].map(name => `pkg:cargo/${name}`).sort(),
	);
	expect(stream.required).toEqual(stream.packages);
	expect(stream.versioning).toBe('workspace');
	expect(stream.promote).toBeUndefined();
	expect(stream.observe).toEqual([{
		name: 'publish',
		file: 'publish.yml',
		ref: 'refs/tags/v*',
		publications: stream.packages,
	}]);
	expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
	expect(plan.blockers).toEqual([]);
	const warnings = plan.notes.filter(note => note.includes('lacks a license file'));
	expect(warnings).toHaveLength(5);
	for (const warning of warnings) {
		expect(warning).toContain('Advisory: the existing publishing workflow controls publication');
	}
	const summary = streamSummary(stream, plan).join('\n');
	expect(summary).toContain('Tags matching v[0-9]* start publish.yml');
	expect(summary).not.toContain('Tags matching v* start');
	expect(summary).toContain('observation filter for publish.yml is refs/tags/v*');
	expect(summary).toContain('crates.io returned 404 for tool-core');
	expect(summary).toContain('Publish its first version with a crates.io API token before using Trusted Publishing');
	const body = setupBody(plan, { branch: 'automation/onboarding', defaultBranch: 'main' });
	expect(body).toContain(summary.split('\n')[0] ?? 'missing summary');
	expect(body).toContain('crates.io returned 404 for tool-core');
	expect(body).not.toContain('unverified');
	expect(body).toContain('Once publishing prerequisites are satisfied, start the next release');
	expect(body).toContain('lacks a license file');
	expect(body).not.toContain('### Held packages');
	expect(body).not.toContain('Beepboop holds its release');
});

test('saved plans without workflow tag evidence do not infer triggers from observation filters', async () => {
	const snapshot = cargoSnapshot();
	const draft = await Effect.runPromise(previewSetup(snapshot, discover(snapshot), undefined, { head: null }));
	for (const workflow of draft.workflows) delete workflow.tagPatterns;
	const plan = await Effect.runPromise(parseSetupPlan(JSON.parse(JSON.stringify(draft))));
	const stream = plan.choices.streams[0];
	if (!stream) throw new Error('Missing Cargo stream');
	const summary = streamSummary(stream, plan).join('\n');
	expect(summary).toContain('runs on its own triggers');
	expect(summary).toContain('observation filter for publish.yml is refs/tags/v*');
	expect(summary).not.toContain('Tags matching');
});

test('metadata remains advisory when no publishing workflow is selected', async () => {
	const snapshot = cargoSnapshot();
	const plan = await Effect.runPromise(
		previewSetup(
			snapshot,
			discover(snapshot),
			{
				streams: [{
					name: 'main',
					packages: ['pkg:cargo/tool'],
					required: ['pkg:cargo/tool'],
					versioning: 'workspace',
				}],
			},
			{ head: null },
		),
	);
	const notes = plan.notes.join('\n');
	expect(notes).toContain('Advisory: address this metadata before publishing.');
	expect(notes).not.toContain('Beepboop holds its release');
	expect(notes).not.toContain('the existing publishing workflow controls publication');
});

function missingCrates(): PublishingAccess {
	return {
		request: async () => new Response(null, { status: 404 }),
		github: () => Effect.succeed(null),
		cargoToken: () => Effect.undefined,
	};
}

function registeredCrates(configs: unknown[] = [], status = 200): PublishingAccess {
	return {
		...missingCrates(),
		request: async (input) =>
			String(input).includes('/trusted_publishing/')
				? Response.json({ github_configs: configs, meta: { next_page: null } }, { status })
				: Response.json({ crate: { max_stable_version: '0.1.0' } }),
	};
}

async function checkedCargo(access: PublishingAccess, snapshot = cargoSnapshot()) {
	return Effect.runPromise(previewSetup(snapshot, discover(snapshot), undefined, { head: null, publishing: access }));
}

test('adoption checks existing crates and the exact trusted publisher using the Worker credential', async () => {
	const access = registeredCrates();
	const calls: string[] = [];
	access.cargoToken = () => Effect.succeed('fixture-registry-token');
	access.request = async (input, init) => {
		const url = new URL(String(input));
		calls.push(url.pathname);
		if (!url.pathname.includes('/trusted_publishing/')) {
			return Response.json({ crate: { max_stable_version: '0.1.0' } });
		}
		expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-registry-token');
		return Response.json({
			github_configs: [{
				crate: url.searchParams.get('crate'),
				repository_owner: 'example',
				repository_name: 'tool',
				workflow_filename: 'publish.yml',
				environment: null,
			}],
			meta: { next_page: null },
		});
	};
	const plan = await checkedCargo(access);
	expect(calls.filter(path => path.includes('/trusted_publishing/'))).toHaveLength(5);
	expect(plan.publishingChecks?.filter(check => check.status !== 'passed')).toEqual([]);
	expect(plan.publishingChecks?.some(check => check.message.includes('id-token: write'))).toBe(true);
	expect(plan.publishingChecks?.filter(check => check.message.includes('has a trusted publisher'))).toHaveLength(5);
	const saved = await Effect.runPromise(parseSetupPlan(JSON.parse(JSON.stringify(plan))));
	expect(saved.publishingChecks).toEqual(plan.publishingChecks);
	expect(JSON.stringify(plan)).not.toContain('fixture-registry-token');
});

test('adoption distinguishes missing publisher bindings, access failures and registry outages', async () => {
	const noBinding = await checkedCargo(
		registeredCrates([{
			crate: 'tool',
			repository_owner: 'example',
			repository_name: 'tool',
			workflow_filename: 'other.yml',
			environment: null,
		}]),
	);
	expect(noBinding.publishingChecks?.filter(check => check.message.includes('No matching publisher'))).toHaveLength(5);
	const forbidden = await checkedCargo(registeredCrates([], 403));
	expect(forbidden.publishingChecks?.filter(check => check.status === 'failed' && check.message.includes('HTTP 403')))
		.toHaveLength(5);
	expect(forbidden.publishingChecks?.some(check => check.message.includes('returned 404'))).toBe(false);
	const outage = await checkedCargo({ ...missingCrates(), request: async () => new Response(null, { status: 503 }) });
	expect(outage.publishingChecks?.filter(check => check.status === 'failed' && check.message.includes('HTTP 503')))
		.toHaveLength(5);
	expect(outage.publishingChecks?.some(check => check.message.includes('Publish its first version'))).toBe(false);
});

test('adoption verifies environment variables, secret availability and OIDC permissions', async () => {
	const snapshot = cargoSnapshot();
	snapshot.files['.github/workflows/publish.yml'] = `on: { push: { tags: ['v[0-9]*'] } }
jobs:
  publish:
    environment: \${{ vars.RELEASE_ENV }}
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: rust-lang/crates-io-auth-action@v1
      - run: cargo publish --workspace
        env:
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_TOKEN }}
`;
	const paths: string[] = [];
	const access = missingCrates();
	access.github = path => {
		paths.push(path);
		if (path.endsWith('/variables/RELEASE_ENV')) return Effect.succeed({ name: 'RELEASE_ENV', value: 'release' });
		if (path.endsWith('/environments/release')) return Effect.succeed({ name: 'release' });
		if (path.endsWith('/environments/release/secrets/CARGO_TOKEN')) return Effect.succeed({ name: 'CARGO_TOKEN' });
		return Effect.succeed(null);
	};
	const plan = await checkedCargo(access, snapshot);
	expect(paths).toContain('/repos/example/tool/environments/release/secrets/CARGO_TOKEN');
	expect(
		plan.publishingChecks?.some(check =>
			check.status === 'passed' && check.message.includes('secret CARGO_TOKEN is available')
		),
	).toBe(true);
	expect(
		plan.publishingChecks?.some(check =>
			check.status === 'action-required' && check.message.includes('needs id-token: write')
		),
	).toBe(true);
	access.github = () => Effect.succeed(null);
	delete snapshot.files['.github/workflows/publish.yml'];
	snapshot.files['.github/workflows/publish.yml'] = `on: { push: { tags: ['v[0-9]*'] } }
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: cargo publish --workspace
        env:
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_TOKEN }}
`;
	const missing = await checkedCargo(access, snapshot);
	expect(
		missing.publishingChecks?.some(check =>
			check.status === 'action-required' && check.message.includes('secret CARGO_TOKEN is missing')
		),
	).toBe(true);
});

test('trusted publisher pagination never sends the Worker credential off crates.io', async () => {
	const access = registeredCrates();
	const requested: string[] = [];
	access.cargoToken = () => Effect.succeed('fixture-registry-token');
	access.request = async input => {
		const url = String(input);
		requested.push(url);
		return url.includes('/trusted_publishing/')
			? Response.json({ github_configs: [], meta: { next_page: 'https://example.invalid/steal' } })
			: Response.json({ crate: { max_stable_version: '0.1.0' } });
	};
	const plan = await checkedCargo(access);
	expect(requested.every(url => new URL(url).origin === 'https://crates.io')).toBe(true);
	expect(
		plan.publishingChecks?.filter(check => check.status === 'failed' && check.message.includes('pagination failed')),
	).toHaveLength(5);
});

test('adoption checks organization secret pagination after environment and repository scopes', async () => {
	const snapshot = cargoSnapshot();
	snapshot.files['.github/workflows/publish.yml'] = `on: { push: { tags: ['v[0-9]*'] } }
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: cargo publish --workspace
        env:
          CARGO_REGISTRY_TOKEN: \${{ secrets.CARGO_TOKEN }}
`;
	const access = missingCrates();
	const paths: string[] = [];
	access.github = path => {
		paths.push(path);
		if (path.includes('organization-secrets') && path.endsWith('page=1')) {
			return Effect.succeed({ secrets: Array.from({ length: 100 }, (_, index) => ({ name: `OTHER_${index}` })) });
		}
		if (path.includes('organization-secrets') && path.endsWith('page=2')) {
			return Effect.succeed({ secrets: [{ name: 'CARGO_TOKEN' }] });
		}
		return Effect.succeed(null);
	};
	const plan = await checkedCargo(access, snapshot);
	expect(paths).toContain('/repos/example/tool/actions/organization-secrets?per_page=100&page=2');
	expect(
		plan.publishingChecks?.some(check =>
			check.status === 'passed' && check.message.includes('secret CARGO_TOKEN is available')
		),
	).toBe(true);
});
