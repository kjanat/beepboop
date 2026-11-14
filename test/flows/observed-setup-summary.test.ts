import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { discover } from '@/automation/managers';
import { previewSetup, setupBody } from '@/automation/setup';
import { parseSetupPlan } from '@/automation/setup-plan';
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
	const draft = await Effect.runPromise(previewSetup(snapshot, inventory, undefined, { head: null }));
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
	expect(summary).toContain('Cargo publisher readiness is unverified');
	expect(summary).toContain('manually publish any new crate first, then configure its trusted publisher');
	const body = setupBody(plan, { branch: 'automation/onboarding', defaultBranch: 'main' });
	expect(body).toContain(summary.split('\n')[0] ?? 'missing summary');
	expect(body).toContain('Cargo publisher readiness is unverified');
	expect(body).toContain('After checking publisher readiness, start the next release');
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
