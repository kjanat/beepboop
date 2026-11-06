import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { discover } from '@/automation/managers';
import { packageId } from '@/automation/package-identity';
import { buildSnapshot } from '@/automation/snapshot';
import { adoptionChoices, adoptionMarkdown } from '@/automation/release-graph/adoption';
import {
	inferReleaseGraph,
	type ReleaseGraph,
	type StreamProposal,
	type Target,
} from '@/automation/release-graph/graph';
import { type Destination, workflowModels } from '@/automation/release-graph/workflows';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { Snapshot } from '@/automation/types';
import { bearer } from '@root/test/support/http.ts';
import { World } from '@root/test/support/world.ts';

const snapshotSchema = z.object({
	repository: z.object({ id: z.number(), name: z.string(), defaultBranch: z.string() }),
	sha: z.string(),
	files: z.record(z.string(), z.string()),
	paths: z.array(z.string()),
	tags: z.array(z.string()).optional(),
});

const snapshots = new Map<string, Snapshot>();
async function snapshotOf(name: string): Promise<Snapshot> {
	const known = snapshots.get(name);
	if (known) return known;
	const parsed = snapshotSchema.parse(
		await Bun.file(new URL(`../fixtures/repositories/${name}.json`, import.meta.url)).json(),
	);
	const snapshot: Snapshot = {
		repository: parsed.repository,
		sha: parsed.sha,
		files: parsed.files,
		paths: parsed.paths,
		...(parsed.tags ? { tags: parsed.tags } : {}),
	};
	snapshots.set(name, snapshot);
	return snapshot;
}
async function load(name: string) {
	return plan(await snapshotOf(name));
}
function plan(snapshot: Snapshot) {
	const inventory = discover(snapshot);
	const graph = inferReleaseGraph(snapshot, inventory);
	return {
		snapshot,
		graph,
		choices: adoptionChoices(graph, inventory),
		markdown: adoptionMarkdown(graph, snapshot).join('\n'),
	};
}

function workflow(on: string, run: string): string {
	return `on: ${on}\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
}
function stream(graph: ReleaseGraph, id: string): StreamProposal {
	const found = graph.streams.find(candidate => candidate.id === id);
	if (!found) throw new Error(`no stream ${id} in ${graph.streams.map(candidate => candidate.id).join(', ')}`);
	return found;
}
function targets(proposal: StreamProposal, destination: Destination): Target[] {
	return proposal.targets.filter(target => target.destination === destination);
}
function target(proposal: StreamProposal, destination: Destination): Target {
	const [found] = targets(proposal, destination);
	if (!found) throw new Error(`no ${destination} target in ${proposal.id}`);
	return found;
}
function destinations(proposal: StreamProposal): Destination[] {
	return [...new Set(proposal.targets.map(candidate => candidate.destination))].sort();
}
function rules(proposal: StreamProposal): string[] {
	return proposal.evidence.map(item => item.rule);
}
function omitted(graph: ReleaseGraph, subject: string): string | undefined {
	return graph.omissions.find(omission => omission.subject === `\`${subject}\``)?.reason;
}
function omissions(graph: ReleaseGraph, subject: string): string[] {
	return graph.omissions.filter(omission => omission.subject === `\`${subject}\``).map(omission => omission.reason);
}
function roleOf(proposal: StreamProposal, file: string): string | undefined {
	return proposal.workflows.find(entry => entry.file === file)?.role;
}

describe('release streams', () => {
	test('kp2bw and pykeepass-stubs keep their own tag families', async () => {
		const { graph, choices } = await load('kp2bw');
		expect(graph.streams.map(proposal => proposal.id).sort()).toEqual(['main', 'stubs']);
		const main = stream(graph, 'main'), stubs = stream(graph, 'stubs');
		expect(main.trigger).toMatchObject({ kind: 'tags', prefix: 'v' });
		expect(stubs.trigger).toMatchObject({ kind: 'tags', prefix: 'stubs-v' });
		expect(target(stubs, 'pypi').names).toEqual(['pykeepass-stubs']);
		expect(target(main, 'pypi').names).toEqual(['kp2bw']);
		expect(target(main, 'github-release').phase).toBeLessThan(target(main, 'pypi').phase);
		expect(target(main, 'pypi').phase).toBeLessThan(target(main, 'oci').phase);
		expect(target(main, 'oci').names).toEqual(['ghcr.io/kjanat/kp2bw']);
		expect(main.aliases).toContain('publish.yml#finalize');
		expect(choices.map(choice => [choice.name, choice.versionSource])).toEqual([
			['stubs', { kind: 'tags', prefix: 'stubs-v' }],
			['main', { kind: 'tags', prefix: 'v' }],
		]);
	});

	test('svg shares one evidenced version and orders its generated npm packages', async () => {
		const { graph } = await load('svg');
		expect(graph.streams).toHaveLength(1);
		const main = stream(graph, 'main');
		expect(main.versionGroup.lockstep).toBe('declared');
		expect(main.versionGroup.carriers).toHaveLength(28);
		expect(main.versionGroup.carriers).toContainEqual({
			path: 'grammars/tree-sitter-svg/tree-sitter.json',
			status: 'declared',
		});
		expect(main.versionGroup.carriers.every(carrier => carrier.status === 'declared')).toBe(true);
		const kinds = main.versionGroup.carriers.map(carrier => carrier.path.split('/').pop());
		for (const kind of ['Cargo.toml', 'extension.toml', 'build.zig.zon', 'CMakeLists.txt', 'Makefile', 'pom.xml']) {
			expect(kinds).toContain(kind);
		}
		const npm = targets(main, 'npm');
		const platforms = npm.find(candidate => candidate.variants.length === 60);
		expect(platforms?.names).toEqual(['60 generated platform packages']);
		const facades = npm.find(candidate => candidate.names.includes('@svg-toolkit/svg-lint'));
		const bundle = npm.find(candidate => candidate.names.includes('@kjanat/svg-toolkit'));
		expect(platforms && facades && bundle).toBeTruthy();
		expect(platforms?.phase).toBeLessThan(facades?.phase ?? 0);
		expect(facades?.phase).toBeLessThan(bundle?.phase ?? 0);
		const crates = targets(main, 'crates-io');
		expect(crates.map(candidate => candidate.phase)).toEqual([...crates.map(candidate => candidate.phase)].sort());
		expect(crates[0]?.names).toContain('svg-data');
		expect(crates.at(-1)?.names).toEqual(['svg-language-server']);
		expect(targets(main, 'pypi')).toEqual([]);
		expect(omitted(graph, 'tree-sitter-svg')).toContain('no release workflow publishes it to PyPI');
		expect(graph.incomplete.map(product => product.kind)).toEqual(['zed-extension']);
	});

	test('envctl ships a native GitHub release and memhogs-tui needs no assets or upload command', async () => {
		const envctl = await load('envctl');
		expect(destinations(stream(envctl.graph, 'main'))).toEqual(['github-release']);
		expect(omitted(envctl.graph, 'envctl')).toBe('private (`package.json`)');
		expect(envctl.choices[0]?.packages).toEqual([]);
		const memhogs = await load('memhogs-tui');
		const main = stream(memhogs.graph, 'main');
		expect(destinations(main)).toEqual(['github-release', 'go-proxy']);
		expect(target(main, 'github-release').variants).toEqual([]);
		expect(target(main, 'go-proxy').names).toEqual(['memhogs.kjanat.dev']);
	});

	test('micro509 and dreamcli keep npm and JSR together without private tooling', async () => {
		const micro509 = await load('micro509');
		const main = stream(micro509.graph, 'main');
		expect(target(main, 'npm').phase).toBe(target(main, 'jsr').phase);
		expect(target(main, 'npm').phase).toBeLessThan(target(main, 'github-release').phase);
		expect(target(main, 'github-release').phase).toBeLessThan(target(main, 'docs').phase);
		expect(main.versionGroup.carriers).toContainEqual({ path: 'jsr.json', status: 'derived' });
		expect(omitted(micro509.graph, '@micro509/tsdown-plugin-argon2')).toStartWith('private');
		expect(omitted(micro509.graph, 'pkg-pr-new.yml')).toContain('pull-request preview');
		expect(stream(micro509.graph, 'openssl').channels).toEqual(['nightly']);
		const dreamcli = await load('dreamcli');
		const release = stream(dreamcli.graph, 'dreamcli');
		expect(release.trigger).toEqual({ kind: 'dispatch', workflow: 'publish.yml' });
		expect(destinations(release)).toEqual(['docs', 'jsr', 'npm']);
		expect(target(release, 'npm').phase).toBe(target(release, 'jsr').phase);
		expect(target(release, 'npm').phase).toBeLessThan(target(release, 'docs').phase);
		expect(omitted(dreamcli.graph, '@kjanat/dreamcli-docs')).toStartWith('private');
	});

	test('shellcheck-rs keeps native and WASM distributions, recovery and delayed aliases', async () => {
		const { graph } = await load('shellcheck-rs');
		const main = stream(graph, 'rshellcheck');
		expect(main.trigger).toMatchObject({ kind: 'tags', prefix: 'rshellcheck-v' });
		expect(target(main, 'pypi').names.sort()).toEqual(['rshellcheck', 'rshellcheck-wasm']);
		expect(target(main, 'npm').names.sort()).toEqual(['@kjanat/rshellcheck', '@kjanat/rshellcheck-wasm']);
		expect(rules(main)).toContain('destination recovery');
		expect(main.aliases).toEqual(['release.yml#upstream-aliases']);
		expect(target(main, 'github-release').phase).toBeLessThan(target(main, 'npm').phase);
		expect(omissions(graph, 'shellcheck-rs-workspace').sort()).toEqual([
			'private (`package.json`)',
			'private (`pyproject.toml`)',
		]);
	});

	test('actionlint separates its SDK and keeps candidate, recovery and alias evidence', async () => {
		const { graph } = await load('actionlint');
		expect(graph.streams.map(proposal => proposal.id).sort()).toEqual(['actionlint', 'changelog', 'sdk']);
		const main = stream(graph, 'actionlint');
		expect(rules(main)).toContain('prepared candidate');
		expect(roleOf(main, 'npm-release.yml')).toBe('recovery');
		expect(roleOf(main, 'pypi-release.yml')).toBe('recovery');
		expect(roleOf(main, 'major-tag.yml')).toBe('maintenance');
		expect(main.aliases).toContain('major-tag.yml#move');
		expect(target(main, 'pypi').names).toEqual(['actionlint-kjanat']);
		expect(target(main, 'winget').downstream).toBe(true);
		expect(target(main, 'winget').required).toBe(false);
		expect(main.versionGroup.carriers).toEqual([
			{ path: 'distribution/npm/facade/package.json', status: 'inferred' },
		]);
		expect(target(stream(graph, 'sdk'), 'crates-io').names).toEqual(['actionlint-extension-api']);
		const moved = await load('actionlint-go-identity-model');
		expect(moved.graph.streams.map(proposal => proposal.id).sort()).toEqual(['actionlint', 'changelog', 'sdk']);
		const sdk = stream(moved.graph, 'sdk');
		expect(sdk.versionGroup.source).toEqual({ kind: 'file', path: 'plugins/sdk/rust/Cargo.toml' });
		expect(target(sdk, 'crates-io').names).toEqual(['actionlint-extension-api']);
	});

	test('udm-iptv analyzes the go line and historical master separately', async () => {
		const go = await load('udm-iptv-go');
		const main = stream(go.graph, 'main');
		expect(main.facets).toContain('debian-package');
		expect(target(main, 'github-release').variants).toContain('Debian packages');
		expect(main.workflows.map(entry => entry.file).sort()).toEqual(['build.yml', 'ci.yml', 'release.yml']);
		expect(target(main, 'github-release').operations).toEqual(['release.yml#publish']);
		expect(roleOf(main, 'build.yml')).toBe('called');
		expect(go.choices[0]?.observe?.map(binding => binding.file)).toEqual(['release.yml']);
		const master = await load('udm-iptv-master');
		expect(stream(master.graph, 'main').workflows.map(entry => entry.file)).toEqual(['release.yml']);
		expect(stream(master.graph, 'unifi-os').channels).toEqual(['nightly']);
	});

	test('kprint keeps CLI and library versions apart and treats dprint names as aliases', async () => {
		const { graph, choices } = await load('kprint');
		const main = stream(graph, 'main'), crates = stream(graph, 'crates');
		expect(crates.versionGroup.lockstep).toBe('conflicting');
		expect(choices.find(choice => choice.name === 'crates')?.versioning).toBe('independent');
		expect(target(main, 'github-release').binaries).toEqual(['kprint']);
		const compatibility = main.evidence.find(item => item.rule === 'compatibility name');
		expect(compatibility?.detail).toContain('`kprint` also ships as `dprint`');
		expect(graph.streams.map(proposal => proposal.id).sort()).toEqual(['crates', 'main']);
		expect(main.channels).toEqual(expect.arrayContaining(['nightly', 'prerelease']));
		expect(target(main, 'oci').required).toBe(true);
		expect(target(main, 'oci-artifact').required).toBe(false);
		expect(target(main, 'npm').names).toEqual(['@kprint/kprint']);
		expect(destinations(main)).toEqual(expect.arrayContaining(['aur', 'homebrew', 'scoop']));
		expect(roleOf(main, 'release.yml')).toBe('initiator');
		const order = targets(crates, 'crates-io').map(candidate => candidate.phase);
		expect(order).toEqual([...order].sort());
	});

	test('mosaic ships only the selected binary and reports the helper revision', async () => {
		const { graph } = await load('mosaic');
		const main = stream(graph, 'main');
		expect(target(main, 'github-release').binaries).toEqual(['mos-lsp']);
		expect(omitted(graph, 'mos')).toContain('GitHub releases ship only `mos-lsp`');
		expect(rules(main)).toContain('helper revision');
		expect(targets(main, 'crates-io').at(-1)?.names).toEqual(['mos']);
		expect((await load('mosaic')).markdown).toContain('`kjanat/mosaic releases` with binaries `mos-lsp`');
		const runner = await load('runner');
		expect(target(stream(runner.graph, 'main'), 'github-release').binaries).toEqual(['runner', 'run']);
		expect(omitted(runner.graph, 'runner-run')).toBeUndefined();
	});

	test('dprint plugins receive plans matching their release systems', async () => {
		const shfmt = stream((await load('dprint-plugin-shfmt')).graph, 'main');
		expect(shfmt.facets).toEqual(expect.arrayContaining(['wasm-plugin', 'no-native-go-binary']));
		expect(target(shfmt, 'github-release').variants).toEqual(expect.arrayContaining(['plugin.wasm', 'schema.json']));
		expect(shfmt.evidence.find(item => item.rule === 'embedded dependency version')?.detail).toContain(
			'`mvdan.cc/sh/v3`',
		);
		const svgo = await load('dprint-plugin-svgo');
		expect(stream(svgo.graph, 'main').facets).toContain('process-plugin');
		expect(stream(svgo.graph, 'main').facets).not.toContain('wasm-plugin');
		expect(svgo.graph.generators).toEqual([{
			source: '.github/workflows/ci.generate.ts',
			workflows: ['check-updates.yml', 'ci.yml', 'pages.yml', 'release.yml'],
		}]);
		expect(svgo.graph.notes.join('\n')).toContain('`release.yml` already requests a Beepboop token');
		const shuck = stream((await load('dprint-plugin-shuck')).graph, 'main');
		expect(roleOf(shuck, 'auto-release.yml')).toBe('initiator');
		expect(rules(shuck)).toEqual(expect.arrayContaining(['release initiation', 'dependency-driven initiation']));
		const tombi = stream((await load('dprint-plugin-tombi')).graph, 'main');
		expect(rules(tombi)).toEqual(expect.arrayContaining(['dependency-driven initiation', 'prepared release commit']));
		const pwsh = await load('dprint-plugin-pwsh');
		expect(pwsh.graph.streams).toEqual([]);
		expect(pwsh.graph.mirror?.producer).toBe('kjanat/powershell-formatter');
		const producer = stream((await load('powershell-formatter')).graph, 'main');
		expect(target(producer, 'github-release').repository).toBe('kjanat/dprint-plugin-pwsh');
		expect(rules(producer)).toContain('destination recovery');
		const sorter = stream((await load('dprint-plugin-sortpackagejson')).graph, 'main');
		expect(target(sorter, 'npm').names).toEqual(['@kjanat/dprint-plugin-sortpackagejson']);
		expect(target(sorter, 'github-release').phase).toBeLessThan(target(sorter, 'npm').phase);
		const zig = stream((await load('dprint-plugin-zig')).graph, 'main');
		expect(destinations(zig)).toEqual(['github-release', 'jsr', 'npm']);
		const schemaSort = stream((await load('dprint-plugin-json-schema-sort')).graph, 'main');
		expect(schemaSort.trigger).toMatchObject({ kind: 'tags', prefix: '' });
		expect(target(schemaSort, 'github-release').variants).toEqual(
			expect.arrayContaining(['plugin.wasm', 'schema.json']),
		);
		const plugin = await load('dprint-plugin-svg');
		expect(target(stream(plugin.graph, 'main'), 'github-release').variants).toEqual(['plugin.wasm', 'schema.json']);
		expect(plugin.graph.omissions.some(omission => omission.reason.includes('builds a binary'))).toBe(false);
		const texFmt = await load('dprint-plugin-tex-fmt');
		expect(destinations(stream(texFmt.graph, 'main'))).toEqual(['github-release']);
		expect(omitted(texFmt.graph, 'dprint-plugin-tex-fmt')).toStartWith('publishing disabled');
	});

	test('actup exposes incomplete editor products without blocking the working release', async () => {
		const { graph, choices, markdown } = await load('actup');
		const main = stream(graph, 'main');
		expect(destinations(main)).toEqual(['crates-io', 'github-release', 'npm', 'oci']);
		expect(target(main, 'npm').names).toEqual(['actup-wasm']);
		const vscode = graph.incomplete.find(product => product.kind === 'vscode-extension');
		expect(vscode?.destinations).toEqual(['vscode-marketplace', 'open-vsx']);
		expect(vscode?.gaps.join('\n')).toContain('`actup-lsp`');
		expect(graph.incomplete.map(product => product.kind)).toContain('zed-extension');
		expect(choices[0]?.required.some(id => id.includes('vscode'))).toBe(false);
		expect(choices[0]?.packages.some(id => id.includes('vscode'))).toBe(false);
		expect(markdown).toContain('### Not ready to publish');
		expect(markdown).toContain('Existing releases do not require it.');
	});

	test('a branch publisher forms a snapshot stream and cargo engine versions are recorded', () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'.github/workflows/snapshot.yml': [
				'name: Snapshot',
				'on:',
				'  push:',
				'    branches: [main]',
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: echo "engine=$(cargo pkgid tree-sitter)" >> "$GITHUB_OUTPUT"',
				'      - run: npm publish --tag snapshot',
				'',
			].join('\n'),
		};
		const { graph, markdown } = plan({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		const widget = stream(graph, 'widget');
		expect(widget.trigger).toEqual({ kind: 'branch', workflow: 'snapshot.yml' });
		expect(widget.channels).toEqual(['snapshot']);
		expect(rules(widget)).toEqual(expect.arrayContaining(['branch push', 'embedded dependency version']));
		expect(widget.evidence.find(item => item.rule === 'embedded dependency version')?.detail).toContain(
			'`tree-sitter`',
		);
		expect(target(widget, 'npm').names).toEqual(['widget']);
		expect(markdown).toContain('pushes that run `snapshot.yml`');
	});

	test('discovery follows wrapper scripts and reads a single tag filter', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'.github/workflows/release.yml': workflow("{ push: { tags: 'tools/v*' } }", './scripts/release.sh'),
			'scripts/release.sh': '#!/bin/sh\n./scripts/publish.sh\n',
			'scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'scripts/unused.sh': '#!/bin/sh\necho unused\n',
		};
		const queried: string[] = [];
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100755' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: prefixes => {
				queried.push(...prefixes);
				return Effect.succeed(['tools/v1.0.0']);
			},
		}));
		expect(snapshot.files['scripts/publish.sh']).toBe(files['scripts/publish.sh']);
		expect(snapshot.files['scripts/unused.sh']).toBeUndefined();
		expect(queried).toContain('tools/v');
		const widget = stream(plan(snapshot).graph, 'tools');
		expect(widget.trigger).toMatchObject({ kind: 'tags', prefix: 'tools/v' });
		expect(target(widget, 'npm').names).toEqual(['widget']);
	});

	test('script runs, snapshot builds, tests and long names do not distort streams', () => {
		const long = 'x'.repeat(70);
		const files: Record<string, string> = {
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/release.yml': [
				'on: { push: { tags: ["v*"] } }',
				'jobs:',
				'  test:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/a && npm test',
				'  publish:',
				'    needs: test',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/b && npm publish',
				'',
			].join('\n'),
			'.github/workflows/ci.yml': [
				'on: { push: { branches: [main] } }',
				'jobs:',
				'  snapshot:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - uses: goreleaser/goreleaser-action@v7',
				'        with: { args: release --snapshot --clean }',
				'      - run: npm run publish:docs',
				'',
			].join('\n'),
			[`.github/workflows/${long}-a.yml`]: workflow('{ workflow_dispatch: {} }', 'gh release create v1'),
			[`.github/workflows/${long}-b.yml`]: workflow('{ workflow_dispatch: {} }', 'gh release create v1'),
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(target(stream(graph, 'main'), 'npm').names).toEqual(['b']);
		expect(graph.streams.flatMap(proposal => proposal.workflows.map(entry => entry.file))).not.toContain('ci.yml');
		const ids = graph.streams.map(proposal => proposal.id).filter(id => id.startsWith('xxx'));
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
		expect(ids.every(id => id.length <= 63)).toBe(true);
	});

	test('a local action contributes only the scripts its steps run', () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'.github/actions/build/action.yml': [
				'runs:',
				'  using: composite',
				'  steps:',
				'    - shell: bash',
				'      run: bash "${GITHUB_ACTION_PATH}/build.sh"',
				'',
			].join('\n'),
			'.github/actions/build/build.sh': '#!/bin/sh\nnpm run build\n',
			'.github/actions/build/release.sh': '#!/bin/sh\nnpm publish\n',
			'.github/actions/publish/action.yml': [
				'runs:',
				'  using: composite',
				'  steps:',
				'    - shell: bash',
				'      run: bash "${GITHUB_ACTION_PATH}/run.sh"',
				'',
			].join('\n'),
			'.github/actions/publish/run.sh': '#!/bin/sh\nnpm publish\n',
			'.github/workflows/ci.yml':
				'on: { push: { branches: [main] } }\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/build\n',
			'.github/workflows/release.yml':
				'on: { push: { tags: ["v*"] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/publish\n',
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(graph.streams.map(proposal => proposal.workflows.map(entry => entry.file))).toEqual([['release.yml']]);
		expect(target(stream(graph, 'main'), 'npm').names).toEqual(['widget']);
	});

	test('working directories, version filters and mixed triggers keep their releases', async () => {
		const files: Record<string, string> = {
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/a/scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'.github/workflows/release.yml': [
				'on:',
				'  push: { tags: ["v1.*"], branches: [release] }',
				'  workflow_dispatch:',
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - working-directory: packages/a',
				'        run: bash scripts/publish.sh',
				'',
			].join('\n'),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed(['v1.2.0']),
		}));
		expect(snapshot.files['packages/a/scripts/publish.sh']).toBe(files['packages/a/scripts/publish.sh']);
		const { graph, choices } = plan(snapshot);
		const main = stream(graph, 'main');
		expect(main.trigger).toMatchObject({ kind: 'tags', prefix: 'v' });
		expect(target(main, 'npm').names).toEqual(['a']);
		expect(choices[0]?.observe?.map(binding => binding.ref)).toEqual(['refs/tags/v*', 'refs/heads/release']);
	});

	test('runner namespaces, nested scripts, negated filters and foreign tag prefixes', () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root', private: true, scripts: { release: 'echo nothing' } }),
			Makefile: 'release:\n\tcd packages/b && npm publish\n',
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/a/scripts/release.sh': '#!/bin/sh\nbash scripts/publish.sh\n',
			'packages/a/scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.goreleaser.yaml': 'project_name: tools\nbuilds: [{ binary: tools }]\n',
			'.github/workflows/release.yml': [
				'on: { push: { tags: ["v*", "!v*-rc*"] } }',
				'jobs:',
				'  a:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - working-directory: packages/a',
				'        run: bash scripts/release.sh',
				'  b:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: make release',
				'',
			].join('\n'),
			'.github/workflows/tools.yml': workflow("{ push: { tags: ['tools/v*'] } }", 'goreleaser release --clean'),
		};
		const { graph, choices } = plan({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(target(stream(graph, 'main'), 'npm').names.sort()).toEqual(['a', 'b']);
		const main = choices.find(choice => choice.name === 'main');
		expect(main?.observe?.map(binding => binding.ref)).toEqual(['refs/tags/v*']);
		const tools = choices.find(choice => choice.name === 'tools');
		expect(tools?.observe).toEqual([{ name: 'tools', file: 'tools.yml', ref: 'refs/tags/tools/v*', publications: [] }]);
	});

	test('package tasks, forwarded arguments, outside actions and standalone reusable publishers', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({
				name: 'root',
				private: true,
				scripts: { build: 'echo build', release: 'npm publish' },
			}),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', scripts: { release: 'npm publish' } }),
			'actions/publish/action.yml':
				'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: cd packages/a && npm publish\n',
			'.github/workflows/build.yml': workflow('{ push: { branches: [main] } }', 'npm run build -- release'),
			'.github/workflows/local.yml': [
				'on: { push: { tags: ["local-v*"] } }',
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - working-directory: packages/a',
				'        run: npm run release',
				'',
			].join('\n'),
			'.github/workflows/action.yml': [
				'on: { push: { tags: ["action-v*"] } }',
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - uses: ./actions/publish',
				'',
			].join('\n'),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['actions/publish/action.yml']).toBe(files['actions/publish/action.yml']);
		const { graph, choices } = plan(snapshot);
		const members = graph.streams.flatMap(proposal => proposal.workflows.map(entry => entry.file));
		expect(members).not.toContain('build.yml');
		expect(target(stream(graph, 'local'), 'npm').names).toEqual(['a']);
		expect(target(stream(graph, 'action'), 'npm').names).toEqual(['a']);
		expect(choices.length).toBe(2);
		const standalone: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'.github/workflows/reusable.yml': [
				'on:',
				'  workflow_dispatch: { inputs: { version: { type: string, required: true } } }',
				'  workflow_call: { inputs: { version: { type: string, required: true } } }',
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: npm publish',
				'',
			].join('\n'),
		};
		const single = plan({
			repository: { id: 1, name: 'octo/single', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: standalone,
			paths: Object.keys(standalone),
		});
		expect(single.graph.streams.map(proposal => proposal.workflows.map(entry => [entry.file, entry.role]))).toEqual([
			[['reusable.yml', 'entry']],
		]);
		expect(single.choices[0]?.observe?.map(binding => binding.file)).toEqual(['reusable.yml']);
	});

	test('shell directories, bun publish, odd PyPI names and many referenced scripts', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root', private: true, scripts: { release: 'echo nothing' } }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', scripts: { release: 'npm publish' } }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'pyproject.toml': '[project]\nname = "foo("\nversion = "1.0.0"\n',
			'tools/pyproject.toml': '[project]\nname = "rich"\nversion = "1.0.0"\n',
			'.github/workflows/a.yml': workflow("{ push: { tags: ['a-v*'] } }", 'cd packages/a && npm run release'),
			'.github/workflows/b.yml': workflow("{ push: { tags: ['b-v*'] } }", 'cd packages/b && bun publish'),
			'.github/workflows/py.yml': workflow("{ push: { tags: ['py-v*'] } }", 'uv publish --project enrich'),
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(target(stream(graph, 'a'), 'npm').names).toEqual(['a']);
		expect(target(stream(graph, 'b'), 'npm').names).toEqual(['b']);
		expect(target(stream(graph, 'py'), 'pypi').names).not.toContain('rich');
		const scripts = Array.from({ length: 450 }, (_, index) => `scripts/s${index}.sh`);
		const many: Record<string, string> = {
			'.github/workflows/many.yml': workflow(
				'{ workflow_dispatch: {} }',
				scripts.map(path => `bash ${path}`).join(' && '),
			),
			...Object.fromEntries(scripts.map(path => [path, 'echo\n'])),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 2, name: 'octo/many', defaultBranch: 'main' },
			sha: 'b'.repeat(40),
			entries: Object.keys(many).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(many[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(Object.keys(snapshot.files)).toHaveLength(400);
	});

	test('cd-relative scripts, executor arguments and manual callers of a shared publisher', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'jsr.json': JSON.stringify({ name: '@octo/tool', version: '1.0.0', exports: './mod.ts' }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/a/scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'.github/workflows/a.yml': workflow("{ push: { tags: ['a-v*'] } }", 'cd packages/a && bash scripts/publish.sh'),
			'.github/workflows/jsr.yml': workflow("{ push: { tags: ['jsr-v*'] } }", 'npm exec -- jsr publish'),
			'.github/workflows/publish.yml': workflow('{ workflow_call: {} }', 'cd packages/a && npm publish'),
			'.github/workflows/tag.yml':
				'on: { push: { tags: ["shared-v*"] } }\njobs:\n  publish:\n    uses: ./.github/workflows/publish.yml\n',
			'.github/workflows/manual.yml':
				'on: { workflow_dispatch: {} }\njobs:\n  publish:\n    uses: ./.github/workflows/publish.yml\n',
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['packages/a/scripts/publish.sh']).toBe(files['packages/a/scripts/publish.sh']);
		const { graph } = plan(snapshot);
		expect(target(stream(graph, 'a'), 'npm').names).toEqual(['a']);
		expect(destinations(stream(graph, 'jsr'))).toEqual(['jsr']);
		expect(graph.omissions.map(omission => omission.subject)).not.toContain('`manual.yml`');
		expect(graph.streams.flatMap(proposal => proposal.workflows.map(entry => entry.file))).toContain('manual.yml');
	});

	test('each workflow binding requires only the packages that workflow publishes', () => {
		const files: Record<string, string> = {
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '2.0.0' }),
			'.github/workflows/a.yml': workflow("{ push: { tags: ['v1.*'] } }", 'cd packages/a && npm publish'),
			'.github/workflows/b.yml': workflow("{ push: { tags: ['v2.*'] } }", 'cd packages/b && npm publish'),
		};
		const { graph, choices } = plan({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(graph.streams.map(proposal => proposal.id)).toEqual(['main']);
		expect(choices[0]?.observe?.map(binding => [binding.file, binding.publications])).toEqual([
			['a.yml', ['pkg:npm/a']],
			['b.yml', ['pkg:npm/b']],
		]);
		const called: Record<string, string> = {
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '2.0.0' }),
			'.github/workflows/publish-a.yml': workflow('{ workflow_call: {} }', 'cd packages/a && npm publish'),
			'.github/workflows/publish-b.yml': workflow('{ workflow_call: {} }', 'cd packages/b && npm publish'),
			'.github/workflows/a.yml':
				'on: { push: { tags: ["v1.*"] } }\njobs:\n  publish:\n    uses: ./.github/workflows/publish-a.yml\n',
			'.github/workflows/b.yml':
				'on: { push: { tags: ["v2.*"] } }\njobs:\n  publish:\n    uses: ./.github/workflows/publish-b.yml\n',
		};
		const wrapped = plan({
			repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: called,
			paths: Object.keys(called),
		});
		expect(wrapped.choices[0]?.observe?.map(binding => [binding.file, binding.publications])).toEqual([
			['a.yml', ['pkg:npm/a']],
			['b.yml', ['pkg:npm/b']],
		]);
	});

	test('crate selections stay per workflow and composite steps keep their directory', () => {
		const crates: Record<string, string> = {
			'Cargo.toml': '[workspace]\nmembers = ["a", "b"]\n',
			'a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
			'b/Cargo.toml': '[package]\nname = "b"\nversion = "2.0.0"\n',
			'.github/workflows/a.yml': workflow("{ push: { tags: ['v1.*'] } }", 'cargo publish -p a'),
			'.github/workflows/b.yml': workflow("{ push: { tags: ['v2.*'] } }", 'cargo publish -p b'),
		};
		const { choices } = plan({
			repository: { id: 1, name: 'octo/crates', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: crates,
			paths: Object.keys(crates),
		});
		expect(choices[0]?.observe?.map(binding => [binding.file, binding.publications])).toEqual([
			['a.yml', ['pkg:cargo/a']],
			['b.yml', ['pkg:cargo/b']],
		]);
		const composite: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root', private: true, scripts: { release: 'echo nothing' } }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', scripts: { release: 'npm publish' } }),
			'.github/actions/release/action.yml': [
				'runs:',
				'  using: composite',
				'  steps:',
				'    - shell: bash',
				'      working-directory: packages/a',
				'      run: npm run release',
				'',
			].join('\n'),
			'.github/workflows/release.yml':
				'on: { push: { tags: ["v*"] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/release\n',
		};
		const { graph } = plan({
			repository: { id: 2, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: composite,
			paths: Object.keys(composite),
		});
		expect(target(stream(graph, 'main'), 'npm').names).toEqual(['a']);
	});

	test('an unqualified publish at the root selects the root package', () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'npm publish'),
		};
		const { graph, choices } = plan({
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(target(stream(graph, 'main'), 'npm').packages).toEqual(['pkg:npm/root-tool']);
		expect(choices[0]?.observe?.map(binding => binding.publications)).toEqual([['pkg:npm/root-tool']]);
	});

	test('manifest paths select crates and disabled steps publish nothing', () => {
		const files: Record<string, string> = {
			'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
			'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
			'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "2.0.0"\n',
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'.github/workflows/release.yml': workflow(
				"{ push: { tags: ['v*'] } }",
				'cargo publish --manifest-path crates/a/Cargo.toml',
			),
			'.github/workflows/validate.yml': [
				"on: { push: { tags: ['check-v*'] } }",
				'jobs:',
				'  validate:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - if: false',
				'        run: npm publish',
				'  skipped:',
				'    if: ${{ false }}',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: npm publish',
				'',
			].join('\n'),
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/crates', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(graph.streams.map(proposal => proposal.workflows.map(entry => entry.file))).toEqual([['release.yml']]);
		expect(target(stream(graph, 'main'), 'crates-io').packages).toEqual(['pkg:cargo/a']);
	});

	test('JSONC task manifests and pinned JSR publishers', () => {
		const jsonc: Record<string, string> = {
			'deno.jsonc':
				'{\n  // tool\n  "name": "@octo/tool",\n  "version": "1.0.0",\n  "exports": "./mod.ts",\n  "tasks": { "release": "deno publish", /* ship */ },\n}\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'deno task release'),
		};
		const tasks = plan({
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: jsonc,
			paths: Object.keys(jsonc),
		});
		expect(target(stream(tasks.graph, 'main'), 'jsr').names).toEqual(['@octo/tool']);
		for (const run of ['npx jsr@0.13.3 publish', 'npx -y jsr@latest publish']) {
			const files: Record<string, string> = {
				'jsr.json': JSON.stringify({ name: '@octo/pinned', version: '1.0.0', exports: './mod.ts' }),
				'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
			};
			const { graph } = plan({
				repository: { id: 2, name: 'octo/pinned', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
			expect(destinations(stream(graph, 'main'))).toEqual(['jsr']);
		}
	});

	test('publication commands, publish directories, nested recipes and sourced scripts', async () => {
		const job = (...runs: string[]) =>
			`on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n${
				runs.map(run => `      - run: ${run}\n`).join('')
			}`;
		const crates: Record<string, string> = {
			'Cargo.toml': '[workspace]\nmembers = ["a", "b"]\n',
			'a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
			'b/Cargo.toml': '[package]\nname = "b"\nversion = "2.0.0"\n',
			'.github/workflows/release.yml': job('cargo build -p b', 'cargo publish -p a'),
		};
		const cargo = plan({
			repository: { id: 1, name: 'octo/crates', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: crates,
			paths: Object.keys(crates),
		});
		expect(target(stream(cargo.graph, 'main'), 'crates-io').packages).toEqual(['pkg:cargo/a']);
		const npm: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0', scripts: { build: 'tsc' } }),
			'.github/workflows/release.yml': job('cd packages/b && npm run build', 'npm publish'),
		};
		const root = plan({
			repository: { id: 2, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: npm,
			paths: Object.keys(npm),
		});
		expect(target(stream(root.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/root-tool']);
		const nested: Record<string, string> = {
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/a/Makefile': 'release:\n\tnpm publish\n',
			'scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
			'.github/workflows/release.yml': [
				"on: { push: { tags: ['v*'] } }",
				'jobs:',
				'  release:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - working-directory: packages/a',
				'        run: make release',
				'',
			].join('\n'),
			'.github/workflows/root.yml': workflow("{ push: { tags: ['root-v*'] } }", 'source scripts/publish.sh'),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 3, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(nested).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(nested[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['packages/a/Makefile']).toBe(nested['packages/a/Makefile']);
		const mono = plan(snapshot);
		expect(target(stream(mono.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
		expect(target(stream(mono.graph, 'root'), 'npm').packages).toEqual(['pkg:npm/root-tool']);
	});

	test('workspace directories select packages and npm lifecycle hooks run', () => {
		const mono = (run: string): Record<string, string> => ({
			'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*', 'tools/*'] }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'tools/c/package.json': JSON.stringify({ name: 'c', version: '1.0.0' }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
		});
		for (
			const [run, expected] of [
				['npm publish --workspace packages/a', ['pkg:npm/a']],
				['npm publish -w ./packages', ['pkg:npm/a', 'pkg:npm/b']],
			] as const
		) {
			const files = mono(run);
			const { graph } = plan({
				repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
			expect(target(stream(graph, 'main'), 'npm').packages).toEqual([...expected]);
		}
		const hooked = (run: string): Record<string, string> => ({
			'package.json': JSON.stringify({
				name: 'tool',
				version: '1.0.0',
				scripts: { release: 'echo release', postrelease: 'npm publish' },
			}),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
		});
		const planned = (run: string) => {
			const files = hooked(run);
			return plan({
				repository: { id: 2, name: 'octo/tool', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
		};
		expect(target(stream(planned('npm run release').graph, 'main'), 'npm').names).toEqual(['tool']);
		expect(planned('npm run release --ignore-scripts').graph.streams).toEqual([]);
		const prefixed: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root', private: true, scripts: { release: 'echo nothing' } }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', scripts: { release: 'npm publish' } }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'npm --prefix packages/a run release'),
		};
		const { graph } = plan({
			repository: { id: 3, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: prefixed,
			paths: Object.keys(prefixed),
		});
		expect(target(stream(graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
	});

	test('prefix flags, mixed root publishes, extensions and python modules', async () => {
		const steps = (...entries: string[]) =>
			`on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n${entries.join('')}`;
		const mono = (workflowText: string): Snapshot => {
			const files: Record<string, string> = {
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': workflowText,
			};
			return {
				repository: { id: 1, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			};
		};
		const prefixed = plan(mono(steps('      - run: npm --prefix packages/a publish\n')));
		expect(target(stream(prefixed.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
		const mixed = plan(
			mono(steps('      - run: npm publish\n', '      - working-directory: packages/a\n        run: npm publish\n')),
		);
		expect(target(stream(mixed.graph, 'main'), 'npm').packages.slice().sort()).toEqual([
			'pkg:npm/a',
			'pkg:npm/root-tool',
		]);
		const extension: Record<string, string> = {
			'package.json': JSON.stringify({
				name: 'lens',
				publisher: 'octo',
				version: '1.0.0',
				engines: { vscode: '^1.90.0' },
			}),
			'.github/workflows/release.yml': steps(
				'      - uses: HaaLeo/publish-vscode-extension@v2\n        with: { registryUrl: https://marketplace.visualstudio.com }\n',
			),
		};
		const vscode: Snapshot = {
			repository: { id: 2, name: 'octo/lens', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: extension,
			paths: Object.keys(extension),
		};
		const ids = discover(vscode).packages.filter(pkg => pkg.manager === 'vscode').map(packageId);
		expect(ids).toHaveLength(1);
		const lens = plan(vscode);
		expect(target(stream(lens.graph, 'main'), 'vscode-marketplace').packages).toEqual(ids);
		expect(lens.choices[0]?.observe?.map(binding => binding.publications)).toEqual([ids]);
		const python: Record<string, string> = {
			'pyproject.toml': '[project]\nname = "tool"\nversion = "1.0.0"\n',
			'tooling/release.py': 'import subprocess\nsubprocess.run("twine upload dist/*", shell=True)\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'python -m tooling.release'),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 3, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(python).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(python[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['tooling/release.py']).toBe(python['tooling/release.py']);
		expect(target(stream(plan(snapshot).graph, 'main'), 'pypi').packages).toEqual(['pkg:pypi/tool']);
	});

	test('streams follow workflow_run chains, release events and tag families', () => {
		const job = (on: string, id: string, run: string, condition?: string) =>
			`${on}\n  ${id}:\n${
				condition ? `    if: ${condition}\n` : ''
			}    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n`;
		const chained: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\n',
			'.github/workflows/ci.yml': `name: CI\n${workflow("{ push: { tags: ['v*'], branches: [main] } }", 'npm test')}`,
			'.github/workflows/release.yml': `name: Release\n${
				workflow("{ workflow_run: { workflows: ['CI'], types: [completed] } }", 'npm publish')
			}`,
			'.github/workflows/crates.yml': `name: Crates\n${
				workflow("{ workflow_run: { workflows: ['Release'], types: [completed] } }", 'cargo publish')
			}`,
		};
		const chain = plan({
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: chained,
			paths: Object.keys(chained),
		});
		const main = stream(chain.graph, 'main');
		expect(main.trigger).toEqual({ kind: 'tags', prefix: 'v', patterns: ['v*'] });
		expect(main.channels).toEqual(['stable']);
		expect(main.workflows.map(entry => [entry.file, entry.role]).sort()).toEqual([
			['ci.yml', 'entry'],
			['crates.yml', 'called'],
			['release.yml', 'called'],
		]);
		expect(chain.choices[0]?.observe).toEqual([
			{ name: 'ci', file: 'ci.yml', ref: 'refs/tags/v*', publications: ['pkg:cargo/tool', 'pkg:npm/tool'] },
			{ name: 'ci-2', file: 'ci.yml', ref: 'refs/heads/main', publications: [] },
		]);
		const families: Record<string, string> = {
			'packages/core/package.json': JSON.stringify({ name: 'core', version: '1.0.0' }),
			'packages/cli/package.json': JSON.stringify({ name: 'cli', version: '2.0.0' }),
			'.github/workflows/release.yml': [
				job(
					"on: { push: { tags: ['core-v*', 'cli-v*'] } }\njobs:",
					'core',
					'cd packages/core && npm publish',
					"startsWith(github.ref_name, 'core-v')",
				),
				job('', 'cli', 'cd packages/cli && npm publish', "startsWith(github.ref_name, 'cli-v')").slice(1),
			].join(''),
		};
		const split = plan({
			repository: { id: 2, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: families,
			paths: Object.keys(families),
		});
		expect(split.choices[0]?.observe?.map(binding => [binding.ref, binding.publications])).toEqual([
			['refs/tags/core-v*', ['pkg:npm/core']],
			['refs/tags/cli-v*', ['pkg:npm/cli']],
		]);
		const released: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'.github/workflows/publish.yml': workflow('{ release: { types: [published] } }', 'npm publish'),
		};
		const release = plan({
			repository: { id: 3, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: released,
			paths: Object.keys(released),
			tags: ['v1.0.0', 'v1.1.0'],
		});
		expect(stream(release.graph, 'tool').trigger).toEqual({ kind: 'release' });
		expect(stream(release.graph, 'tool').channels).toEqual(['stable']);
		expect(stream(release.graph, 'tool').versionGroup.source).toEqual({ kind: 'tags', prefix: 'v' });
		expect(release.choices[0]?.observe).toEqual([
			{ name: 'publish', file: 'publish.yml', ref: 'refs/tags/v*', publications: ['pkg:npm/tool'] },
		]);
		const branch = plan({
			repository: { id: 4, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: {
				'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
				'.github/workflows/publish.yml': workflow(
					'{ push: { branches: [main] }, workflow_dispatch: {} }',
					'npm publish',
				),
			},
			paths: ['package.json', '.github/workflows/publish.yml'],
		});
		expect(stream(branch.graph, 'tool').trigger).toEqual({ kind: 'branch', workflow: 'publish.yml' });
		expect(stream(branch.graph, 'tool').channels).toEqual(['snapshot']);
	});

	test('selection honors matrices, mentions, exclusions, extensions and mirrors', () => {
		const matrixed = (crates: boolean): Record<string, string> =>
			crates
				? {
					'Cargo.toml': '[workspace]\nmembers = ["a", "b", "c"]\n',
					'a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
					'b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
					'c/Cargo.toml': '[package]\nname = "c"\nversion = "1.0.0"\n',
					'.github/workflows/release.yml':
						"on: { push: { tags: ['v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        crate: [a, b]\n    steps:\n      - run: cargo publish -p ${{ matrix.crate }}\n",
				}
				: {
					'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }),
					'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
					'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
					'packages/c/package.json': JSON.stringify({ name: 'c', version: '1.0.0' }),
					'.github/workflows/release.yml':
						"on: { push: { tags: ['v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        package: [a, b]\n    steps:\n      - run: npm publish --workspace ${{ matrix.package }}\n",
				};
		const planned = (files: Record<string, string>, id = 1) =>
			plan({
				repository: { id, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
		expect(target(stream(planned(matrixed(true)).graph, 'main'), 'crates-io').packages).toEqual([
			'pkg:cargo/a',
			'pkg:cargo/b',
		]);
		expect(target(stream(planned(matrixed(false)).graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		const scoped = planned({
			'packages/core/package.json': JSON.stringify({ name: '@octo/core', version: '1.0.0' }),
			'packages/cli/package.json': JSON.stringify({ name: '@octo/cli', version: '1.0.0' }),
			'.github/workflows/release.yml': [
				"on: { push: { tags: ['v*'] } }",
				'jobs:',
				'  release:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: npx @octo/cli check',
				'      - run: cd packages/core && npm publish',
				'      - run: npm view @octo/cli version',
				'',
			].join('\n'),
		});
		expect(target(stream(scoped.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/%40octo/core']);
		const excluded = planned({
			'Cargo.toml': '[workspace]\nmembers = ["a", "b", "examples"]\n',
			'a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
			'b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
			'examples/Cargo.toml': '[package]\nname = "examples"\nversion = "1.0.0"\n',
			'.github/workflows/release.yml': workflow(
				"{ push: { tags: ['v*'] } }",
				'cargo publish --workspace --exclude examples',
			),
		});
		expect(target(stream(excluded.graph, 'main'), 'crates-io').packages).toEqual(['pkg:cargo/a', 'pkg:cargo/b']);
		const checked = planned({
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/release.yml': [
				"on: { push: { tags: ['v*'] } }",
				'jobs:',
				'  check:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/a && npm pack --dry-run',
				'  publish:',
				'    needs: check',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/b && npm publish',
				'',
			].join('\n'),
		});
		expect(target(stream(checked.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/b']);
		const generated = planned({
			'Cargo.toml': '[workspace]\nmembers = ["crates/tool"]\n[workspace.package]\nversion = "1.0.0"\n',
			'crates/tool/Cargo.toml': '[package]\nname = "tool"\nversion.workspace = true\n',
			'npm/targets.json': JSON.stringify({
				scope: '@octo',
				facade: '@octo/tool',
				targets: [{ pkg: 'tool-linux-x64', target: 'x86_64-unknown-linux-gnu' }],
			}),
			'npm/publish.js': 'execSync("npm publish", { cwd: dir });\n',
			'packages/theme/package.json': JSON.stringify({ name: '@octo/theme', version: '3.0.0' }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'node npm/publish.js'),
			'.github/workflows/theme.yml': workflow("{ push: { tags: ['theme-v*'] } }", 'cd packages/theme && npm publish'),
		});
		expect(target(stream(generated.graph, 'theme'), 'npm').packages).toEqual(['pkg:npm/%40octo/theme']);
		expect(target(stream(generated.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/%40octo/tool-linux-x64']);
		const extensions = planned({
			'ext/a/package.json': JSON.stringify({
				name: 'a',
				publisher: 'octo',
				version: '1.0.0',
				engines: { vscode: '^1.90.0' },
			}),
			'ext/b/package.json': JSON.stringify({
				name: 'b',
				publisher: 'octo',
				version: '1.0.0',
				engines: { vscode: '^1.90.0' },
			}),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'cd ext/a && npx vsce publish'),
		});
		expect(target(stream(extensions.graph, 'main'), 'vscode-marketplace').packages).toEqual([
			'pkg:vscode-extension/octo/a',
		]);
		expect(omitted(extensions.graph, 'octo.b')).toContain('Visual Studio Marketplace');
		const mirrored = plan({
			repository: { id: 7, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: {
				'go.mod': 'module github.com/octo/tool\n\ngo 1.22\n',
				'.goreleaser.yaml': 'project_name: tool\nbuilds: [{ binary: tool }]\n',
				'.github/workflows/release.yml': workflow(
					"{ push: { tags: ['v*'] } }",
					'gh release create "$GITHUB_REF_NAME" dist/* && gh release upload "$GITHUB_REF_NAME" plugin.wasm --repo octo/plugin',
				),
			},
			paths: ['go.mod', '.goreleaser.yaml', '.github/workflows/release.yml'],
			tags: ['v1.0.0'],
		});
		const releases = targets(stream(mirrored.graph, 'main'), 'github-release');
		expect(releases.map(entry => [entry.repository, entry.packages])).toEqual([
			[undefined, ['pkg:github/octo/tool']],
			['octo/plugin', []],
		]);
		expect(target(stream(mirrored.graph, 'main'), 'go-proxy').packages).toEqual(['pkg:golang/github.com/octo/tool']);
		const prefixed = planned({
			'foo/pyproject.toml': '[project]\nname = "foo"\nversion = "1.0.0"\n',
			'foo-bar/pyproject.toml': '[project]\nname = "foo-bar"\nversion = "1.0.0"\n',
			'.github/workflows/release.yml': [
				"on: { push: { tags: ['v*'] } }",
				'jobs:',
				'  release:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd foo && uv publish',
				'      - run: cd foo-bar && uv publish',
				'',
			].join('\n'),
		});
		expect(target(stream(prefixed.graph, 'main'), 'pypi').packages).toEqual(['pkg:pypi/foo', 'pkg:pypi/foo-bar']);
		expect(prefixed.graph.omissions).toEqual([]);
	});

	test('rehearsals, staging registries and release tooling', async () => {
		const tool = JSON.stringify({ name: 'tool', version: '1.0.0', scripts: { release: 'npm publish' } });
		const planned = (files: Record<string, string>, id = 1) =>
			plan({
				repository: { id, name: 'octo/tool', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
		const publishes = (files: Record<string, string>) =>
			planned(files).graph.streams.flatMap(proposal => proposal.targets.map(entry => entry.destination));
		for (
			const run of [
				"npm publish --provenance ${{ inputs.dry-run && '--dry-run' || '' }}",
				'if [ "$DRY" = "1" ]; then npm publish --dry-run; else npm publish; fi',
				'pnpm exec changeset publish',
				'npx changeset publish',
				'npx lerna publish from-git --yes',
			]
		) {
			expect(
				publishes({
					'package.json': tool,
					'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
				}),
			)
				.toEqual(['npm']);
		}
		expect(publishes({
			'package.json': tool,
			'.github/workflows/release.yml': workflow('{ push: { branches: [main] } }', 'npx semantic-release'),
		})).toEqual(['github-release', 'npm']);
		expect(publishes({
			'package.json': tool,
			'.github/workflows/release.yml':
				'on: { push: { branches: [main] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: googleapis/release-please-action@v4\n        id: release\n      - if: ${{ steps.release.outputs.release_created }}\n        run: npm publish\n',
		})).toEqual(['github-release', 'npm']);
		expect(publishes({
			'package.json': tool,
			'.github/workflows/release.yml':
				'on: { push: { branches: [main] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: changesets/action@v1\n        with:\n          publish: npm run release\n',
		})).toEqual(['npm']);
		const py = '[project]\nname = "tool"\nversion = "1.0.0"\n';
		expect(publishes({
			'pyproject.toml': py,
			'.github/workflows/release.yml': workflow(
				'{ push: { branches: [main] } }',
				'python -m twine upload --repository testpypi dist/*',
			),
		})).toEqual([]);
		expect(publishes({
			'pyproject.toml': py,
			'.github/workflows/release.yml':
				'on: { push: { branches: [main] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: pypa/gh-action-pypi-publish@release/v1\n        with: { repository-url: https://test.pypi.org/legacy/ }\n',
		})).toEqual([]);
		expect(publishes({
			'.goreleaser.yaml': 'project_name: tool\nbuilds: [{ binary: tool }]\n',
			'go.mod': 'module github.com/octo/tool\n\ngo 1.22\n',
			'.github/workflows/ci.yml':
				'on: { pull_request: {}, push: { tags: ["v*"] } }\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: goreleaser/goreleaser-action@v6\n        with: { args: release --clean --skip-publish }\n',
		})).toEqual([]);
		const crate = '[package]\nname = "tool"\nversion = "1.0.0"\n';
		expect(
			publishes({
				'Cargo.toml': crate,
				'.github/workflows/check.yml': workflow('{ pull_request: {} }', 'cargo release --no-confirm'),
			}),
		)
			.toEqual([]);
		expect(
			publishes({
				'Cargo.toml': crate,
				'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'cargo release --execute --no-confirm'),
			}),
		)
			.toEqual(['crates-io']);
		expect(publishes({
			'Cargo.toml': '[workspace]\nmembers = ["a"]\n',
			'a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
			'.github/workflows/release.yml': workflow(
				"{ push: { tags: ['v*'] } }",
				'cargo workspaces publish --from-git --yes',
			),
		})).toEqual(['crates-io']);
		const scripted = async (files: Record<string, string>) =>
			Effect.runPromise(buildSnapshot({
				repository: { id: 2, name: 'octo/tool', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
				read: path => Effect.succeed(files[path] ?? null),
				tags: () => Effect.succeed([]),
			}));
		const release = "import { $ } from 'bun';\nawait $`npm publish`;\n";
		for (
			const run of ['npx tsx scripts/release.ts', 'pnpm tsx scripts/release.ts', 'node --import tsx scripts/release.ts']
		) {
			const snapshot = await scripted({
				'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
				'scripts/release.ts': release,
				'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
			});
			expect(destinations(stream(plan(snapshot).graph, 'main'))).toEqual(['npm']);
		}
		const deno = await scripted({
			'jsr.json': JSON.stringify({ name: '@octo/tool', version: '1.0.0', exports: './mod.ts' }),
			'scripts/release.ts': "await new Deno.Command('deno', { args: ['publish'] }).output();\n",
			'.github/workflows/release.yml': workflow(
				"{ push: { tags: ['v*'] } }",
				'deno run -A --config deno.json scripts/release.ts',
			),
		});
		expect(destinations(stream(plan(deno).graph, 'main'))).toEqual(['jsr']);
		expect(publishes({
			'package.json': tool,
			'.github/actions/publish/action.yml':
				'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: npm publish\n',
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: octo/tool/.github/actions/publish@main\n",
		})).toEqual(['npm']);
	});

	test('workspace selectors, recipe directories and task dependencies', async () => {
		const mono = (run: string, extra: Record<string, string> = {}): Record<string, string> => ({
			'package.json': JSON.stringify({
				name: 'root',
				private: true,
				workspaces: ['packages/*'],
				scripts: { release: 'echo root' },
			}),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', scripts: { release: 'npm publish' } }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0', scripts: { build: 'tsc' } }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", run),
			...extra,
		});
		const packages = (files: Record<string, string>, id = 1) =>
			target(
				stream(
					plan({
						repository: { id, name: 'octo/mono', defaultBranch: 'main' },
						sha: 'a'.repeat(40),
						files,
						paths: Object.keys(files),
					}).graph,
					'main',
				),
				'npm',
			).packages;
		for (
			const run of [
				'npm run release -w packages/a',
				'npm run release --workspace=packages/a',
				'pnpm --filter a run release',
				'pnpm -r run release',
				'yarn workspace a run release',
				'yarn --cwd packages/a release',
				'yarn workspace a npm publish',
				'pnpm --filter ./packages/a publish',
				'pnpm publish --filter a',
				'pnpm -F a publish',
			]
		) expect(packages(mono(run))).toEqual(['pkg:npm/a']);
		expect(packages(mono('cd packages/a && npm publish && cd ../b && npm publish'))).toEqual([
			'pkg:npm/a',
			'pkg:npm/b',
		]);
		expect(packages(mono('make release', { Makefile: 'release:\n\t@cd packages/a && npm publish\n' }))).toEqual([
			'pkg:npm/a',
		]);
		const built = async (files: Record<string, string>) =>
			Effect.runPromise(buildSnapshot({
				repository: { id: 3, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
				read: path => Effect.succeed(files[path] ?? null),
				tags: () => Effect.succeed([]),
			}));
		const nested = await built(
			mono('make -C packages/a release', { 'packages/a/Makefile': 'release:\n\tnpm publish\n' }),
		);
		expect(nested.files['packages/a/Makefile']).toBeDefined();
		expect(target(stream(plan(nested).graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
		const recursive = await built(mono('make release', {
			Makefile: 'release:\n\t$(MAKE) -C packages/a publish\n',
			'packages/a/Makefile': 'publish:\n\tnpm publish\n',
		}));
		expect(target(stream(plan(recursive).graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
		const tool = JSON.stringify({ name: 'tool', version: '1.0.0' });
		const single = (files: Record<string, string>) =>
			destinations(
				stream(
					plan({
						repository: { id: 4, name: 'octo/tool', defaultBranch: 'main' },
						sha: 'a'.repeat(40),
						files,
						paths: Object.keys(files),
					}).graph,
					'main',
				),
			);
		expect(single({
			'package.json': tool,
			'mise.toml':
				'[tasks.release]\ndepends = ["build", "publish"]\n\n[tasks.build]\nrun = "echo build"\n\n[tasks.publish]\nrun = "npm publish"\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'mise run release'),
		})).toEqual(['npm']);
		expect(single({
			'package.json': tool,
			justfile:
				'release version: build (publish version)\n\nbuild:\n\techo build\n\npublish version:\n\tnpm publish --tag {{version}}\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'just release 1.2.3'),
		})).toEqual(['npm']);
		const matrixed: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', workspaces: ['packages/*'] }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        dir: [packages/a, packages/b]\n    steps:\n      - working-directory: ${{ matrix.dir }}\n        run: npm publish\n",
		};
		expect(packages(matrixed, 5)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(packages({
			...matrixed,
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        dir: [packages/a, packages/b]\n        exclude:\n          - dir: packages/b\n    steps:\n      - working-directory: ${{ matrix.dir }}\n        run: npm publish\n",
		}, 6)).toEqual(['pkg:npm/a']);
		expect(packages({
			...matrixed,
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        dir: [packages/a, packages/b]\n        os: [linux, windows]\n        exclude:\n          - dir: packages/b\n            os: windows\n    steps:\n      - working-directory: ${{ matrix.dir }}\n        run: npm publish\n",
		}, 7)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
	});

	test('python modules publish from the invoking directory and root package entry points', async () => {
		const modulePlan = async (files: Record<string, string>, id: number) => {
			const snapshot = await Effect.runPromise(buildSnapshot({
				repository: { id, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
				read: path => Effect.succeed(files[path] ?? null),
				tags: () => Effect.succeed([]),
			}));
			return { snapshot, graph: plan(snapshot).graph };
		};
		const workspace = {
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', workspaces: ['packages/*'] }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
		};
		const nested = await modulePlan({
			...workspace,
			'tooling/release.py': 'import os\nos.system("npm publish")\n',
			'.github/workflows/release.yml':
				`on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: packages/a\n        run: python -m tooling.release\n`,
		}, 8);
		expect(target(stream(nested.graph, 'main'), 'npm').packages).toEqual(['pkg:npm/a']);
		const entry = await modulePlan({
			'pyproject.toml': '[project]\nname = "tool"\nversion = "1.0.0"\n',
			'tooling/release/__main__.py': 'import subprocess\nsubprocess.run("twine upload dist/*", shell=True)\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'python -m tooling.release'),
		}, 9);
		expect(entry.snapshot.files['tooling/release/__main__.py']).toBeDefined();
		expect(target(stream(entry.graph, 'main'), 'pypi').packages).toEqual(['pkg:pypi/tool']);
	});

	test('actions referenced by the repository name are fetched and traversed', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'actions/publish/action.yml':
				'name: publish\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      run: npm publish\n',
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: octo/tool/actions/publish@main\n",
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 10, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['actions/publish/action.yml']).toBe(files['actions/publish/action.yml']);
		expect(target(stream(plan(snapshot).graph, 'main'), 'npm').packages).toEqual(['pkg:npm/tool']);
	});

	test('job defaults, parent paths, cargo commands, tag refs and npm workspaces select their own packages', async () => {
		const planned = (files: Record<string, string>, id: number) =>
			plan({
				repository: { id, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files,
				paths: Object.keys(files),
			});
		const selected = (files: Record<string, string>, id: number, destination: Destination) =>
			[...target(stream(planned(files, id).graph, 'main'), destination).packages].sort();
		const workspace = {
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', workspaces: ['packages/*'] }),
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
		};
		const release = (steps: string, extra = '') =>
			`on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
		expect(selected(
			{
				...workspace,
				'.github/workflows/release.yml': release(
					'      - run: npm publish\n',
					'    strategy:\n      matrix:\n        pkg: [a]\n    defaults:\n      run:\n        working-directory: packages/${{ matrix.pkg }}\n',
				),
			},
			20,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'scripts/publish.sh': 'npm publish\n',
				'.github/workflows/release.yml': release(
					'      - working-directory: packages/a\n        run: bash ../../scripts/publish.sh\n',
				),
			},
			21,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release(
					'      - run: cargo publish -p a\n      - run: cargo publish --manifest-path crates/b/Cargo.toml\n',
				),
			},
			22,
			'crates-io',
		)).toEqual(['pkg:cargo/a', 'pkg:cargo/b']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/release.yml': release('      - run: npm publish --workspaces\n'),
			},
			23,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/release.yml': release('      - run: npm publish --workspaces --include-workspace-root\n'),
			},
			24,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b', 'pkg:npm/root-tool']);
		expect(selected(
			{
				...workspace,
				'examples/demo/package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish --workspaces\n'),
			},
			26,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release(
					'      - working-directory: crates\n        run: cargo publish --manifest-path a/Cargo.toml\n',
				),
			},
			27,
			'crates-io',
		)).toEqual(['pkg:cargo/a']);
		expect(selected(
			{
				...workspace,
				'examples/demo/package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish --workspaces --include-workspace-root\n'),
			},
			28,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b', 'pkg:npm/root-tool']);
		expect(selected(
			{
				...workspace,
				'scripts/publish.sh': 'npm publish\n',
				'.github/workflows/release.yml': release(
					'      - run: |\n          cd packages/a\n          bash ../../scripts/publish.sh\n          cd ../b\n          bash ../../scripts/publish.sh\n',
				),
			},
			29,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
				'scripts/release.sh': 'npm publish\n',
				'.github/workflows/release.yml': release('      - run: npm publish --dry-run && bash scripts/release.sh\n'),
			},
			30,
			'npm',
		)).toEqual(['pkg:npm/tool']);
		const scoped = selected(
			{
				'package.json': JSON.stringify({
					name: 'root-tool',
					version: '1.0.0',
					workspaces: ['packages/*'],
					scripts: { release: 'echo release' },
				}),
				'packages/a/package.json': JSON.stringify({
					name: '@scope/a',
					version: '1.0.0',
					scripts: { release: 'npm publish' },
				}),
				'.github/workflows/release.yml': release('      - run: npm run release -w @scope/a\n'),
			},
			31,
			'npm',
		);
		expect(scoped).toHaveLength(1);
		expect(scoped[0]).toContain('scope');
		expect(selected(
			{
				...workspace,
				'tooling/release.py': 'print("rehearse")\n',
				'packages/a/tooling/release.py': 'import os\nos.system("npm publish")\n',
				'.github/workflows/release.yml': release(
					'      - working-directory: packages/a\n        run: python -m tooling.release\n',
				),
			},
			32,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/publish.yml':
					'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: npm publish\n',
				'.github/workflows/release.yml':
					"on: { push: { tags: ['v*'] } }\njobs:\n  a:\n    uses: ./.github/workflows/publish.yml\n    with:\n      directory: packages/a\n  b:\n    uses: ./.github/workflows/publish.yml\n    with:\n      directory: packages/b\n",
			},
			33,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				...workspace,
				'actions/publish/action.yml':
					'name: publish\ninputs:\n  directory:\n    required: true\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      working-directory: ${{ inputs.directory }}\n      run: npm publish\n',
				'.github/workflows/release.yml':
					"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./actions/publish\n        with:\n          directory: packages/a\n",
			},
			34,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/release.yml': release(
					'      - working-directory: ${{ matrix.directory }}\n        run: ${{ matrix.command }}\n',
					'    strategy:\n      matrix:\n        include:\n          - directory: packages/a\n            command: npm publish\n          - directory: packages/b\n            command: echo skip\n',
				),
			},
			38,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'actions/publish/action.yml':
					'name: publish\ninputs:\n  directory:\n    default: packages/a\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      working-directory: ${{ inputs.directory }}\n      run: npm publish\n',
				'.github/workflows/release.yml': release('      - uses: ./actions/publish\n'),
			},
			39,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/publish.yml':
					'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\n        default: packages/a\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: npm publish\n',
				'.github/workflows/release.yml':
					"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    uses: ./.github/workflows/publish.yml\n",
			},
			40,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'packages/a/package.json': JSON.stringify({
					name: 'a',
					version: '1.0.0',
					scripts: { release: 'npm publish' },
				}),
				'tooling/release.py': 'import subprocess\nsubprocess.run("""\nnpm run release\n""", shell=True)\n',
				'.github/workflows/release.yml': release(
					'      - working-directory: packages/a\n        run: python -m tooling.release\n',
				),
			},
			41,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/c.yml':
					'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: npm publish\n',
				'.github/workflows/b.yml':
					'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  forward:\n    uses: ./.github/workflows/c.yml\n    with:\n      directory: ${{ inputs.directory }}\n',
				'.github/workflows/a.yml':
					"on: { push: { tags: ['v*'] } }\njobs:\n  start:\n    uses: ./.github/workflows/b.yml\n    with:\n      directory: packages/a\n",
			},
			42,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				...workspace,
				'actions/publish/action.yml':
					'name: publish\ninputs:\n  directory:\n    required: true\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      working-directory: ${{ inputs.directory }}\n      run: npm publish\n',
				'.github/workflows/release.yml': release(
					'      - uses: ./actions/publish\n        with:\n          directory: ${{ matrix.directory }}\n',
					'    strategy:\n      matrix:\n        directory: [packages/a, packages/b]\n',
				),
			},
			43,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		const callee =
			'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: npm publish\n';
		const caller = (tag: string, directory: string) =>
			`on: { push: { tags: ['${tag}-v*'] } }\njobs:\n  release:\n    uses: ./.github/workflows/publish.yml\n    with:\n      directory: ${directory}\n`;
		const separate = planned({
			...workspace,
			'.github/workflows/publish.yml': callee,
			'.github/workflows/a.yml': caller('a', 'packages/a'),
			'.github/workflows/b.yml': caller('b', 'packages/b'),
		}, 35);
		expect(
			separate.graph.streams.map(proposal =>
				proposal.targets.filter(entry => entry.destination === 'npm').flatMap(entry => entry.packages)
			).sort(),
		).toEqual([['pkg:npm/a'], ['pkg:npm/b']]);
		expect(selected(
			{
				...workspace,
				'.github/workflows/publish.yml': callee,
				'.github/workflows/release.yml':
					"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    strategy:\n      matrix:\n        directory: [packages/a, packages/b]\n    uses: ./.github/workflows/publish.yml\n    with:\n      directory: ${{ matrix.directory }}\n",
			},
			44,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				...workspace,
				'scripts/publish.sh': 'npm publish\n',
				'.github/workflows/release.yml': release(
					'      - run: cd packages/a && bash ../../scripts/publish.sh && cd ../b && bash ../../scripts/publish.sh\n',
				),
			},
			45,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				...workspace,
				'.github/workflows/release.yml': release(
					'      - run: cd packages/${{ matrix.pkg }} && npm publish\n',
					'    strategy:\n      matrix:\n        pkg: [a, b]\n',
				),
			},
			46,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		const parentFiles: Record<string, string> = {
			...workspace,
			'packages/scripts/publish.sh': 'npm publish\n',
			'.github/workflows/release.yml': release(
				'      - working-directory: packages/a\n        run: bash ../scripts/publish.sh\n',
			),
		};
		const parentSnapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 47, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(parentFiles).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(parentFiles[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(parentSnapshot.files['packages/scripts/publish.sh']).toBe('npm publish\n');
		expect([...target(stream(plan(parentSnapshot).graph, 'main'), 'npm').packages].sort()).toEqual(['pkg:npm/a']);
		const released = (name: string) => JSON.stringify({ name, version: '1.0.0', scripts: { release: 'npm publish' } });
		expect(selected(
			{
				...workspace,
				'packages/a/package.json': released('a'),
				'packages/b/package.json': released('b'),
				'.github/workflows/release.yml': release('      - run: npm run release --workspaces\n'),
			},
			49,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				...workspace,
				'packages/a/package.json': released('a'),
				'examples/demo/package.json': released('demo'),
				'.github/workflows/release.yml': release('      - run: npm run release --workspaces\n'),
			},
			51,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				'Cargo.toml': '[package]\nname = "root-crate"\nversion = "1.0.0"\n\n[workspace]\nmembers = ["crates/a"]\n',
				'src/lib.rs': '',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release(
					'      - working-directory: crates/a\n        run: cargo publish\n      - run: cargo publish\n',
				),
			},
			50,
			'crates-io',
		)).toEqual(['pkg:cargo/a', 'pkg:cargo/root-crate']);
		const repeated: Record<string, string> = {
			...workspace,
			'packages/a/package.json': released('a'),
			'packages/b/package.json': released('b'),
			'.github/workflows/release.yml': release('      - run: npm run release -w a -w b\n'),
		};
		const modeled = workflowModels({
			repository: { id: 52, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: repeated,
			paths: Object.keys(repeated),
		});
		expect(
			modeled.flatMap(model => model.jobs.flatMap(job => job.effects)).flatMap(effect =>
				effect.kind === 'publish' ? effect.directory ?? [] : []
			).sort(),
		).toEqual(['packages/a', 'packages/b']);
		const matrixFiles: Record<string, string> = {
			...workspace,
			'packages/a/scripts/publish.sh': 'npm publish\n',
			'packages/b/scripts/publish.sh': 'npm publish\n',
			'.github/workflows/release.yml': release(
				'      - working-directory: ${{ matrix.directory }}\n        run: bash scripts/publish.sh\n',
				'    strategy:\n      matrix:\n        directory: [packages/a, packages/b]\n',
			),
		};
		const matrixSnapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 53, name: 'octo/mono', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(matrixFiles).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(matrixFiles[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(Object.keys(matrixSnapshot.files).filter(path => path.endsWith('scripts/publish.sh')).sort()).toEqual([
			'packages/a/scripts/publish.sh',
			'packages/b/scripts/publish.sh',
		]);
		expect([...target(stream(plan(matrixSnapshot).graph, 'main'), 'npm').packages].sort()).toEqual([
			'pkg:npm/a',
			'pkg:npm/b',
		]);
		const built = (files: Record<string, string>, id: number) =>
			Effect.runPromise(buildSnapshot({
				repository: { id, name: 'octo/mono', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
				read: path => Effect.succeed(files[path] ?? null),
				tags: () => Effect.succeed([]),
			}));
		const pnpm = await built({
			'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
			'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
			'packages/a/package.json': released('a'),
			'examples/demo/package.json': released('demo'),
			'.github/workflows/release.yml': release('      - run: pnpm -r run release\n'),
		}, 54);
		expect([...target(stream(plan(pnpm).graph, 'main'), 'npm').packages].sort()).toEqual(['pkg:npm/a']);
		const reusableScripts = await built({
			...workspace,
			'packages/a/scripts/publish.sh': 'npm publish\n',
			'.github/workflows/publish.yml':
				'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: bash scripts/publish.sh\n',
			'.github/workflows/release.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  release:\n    uses: ./.github/workflows/publish.yml\n    with:\n      directory: packages/a\n",
		}, 55);
		expect(reusableScripts.files['packages/a/scripts/publish.sh']).toBe('npm publish\n');
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release('      - run: cargo publish --package=a\n'),
			},
			56,
			'crates-io',
		)).toEqual(['pkg:cargo/a']);
		expect(selected(
			{
				'package.json': JSON.stringify({
					name: 'root-tool',
					version: '1.0.0',
					scripts: { prepublishOnly: 'npm --prefix packages/a publish' },
				}),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish\n'),
			},
			57,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/root-tool']);
		const prefixedCallee =
			'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm --prefix ${{ inputs.directory }} publish\n';
		const prefixed = planned({
			...workspace,
			'.github/workflows/publish.yml': prefixedCallee,
			'.github/workflows/a.yml': caller('a', 'packages/a'),
			'.github/workflows/b.yml': caller('b', 'packages/b'),
		}, 58);
		expect(
			prefixed.graph.streams.map(proposal =>
				proposal.targets.filter(entry => entry.destination === 'npm').flatMap(entry => entry.packages)
			).sort(),
		).toEqual([['pkg:npm/a'], ['pkg:npm/b']]);
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\ndefault-members = ["crates/a"]\n',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release('      - run: cargo publish\n'),
			},
			59,
			'crates-io',
		)).toEqual(['pkg:cargo/a']);
		const nestedScripts = await built({
			...workspace,
			'packages/a/scripts/publish.sh': 'npm publish\n',
			'.github/workflows/c.yml':
				'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: bash scripts/publish.sh\n',
			'.github/workflows/b.yml':
				'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  forward:\n    uses: ./.github/workflows/c.yml\n    with:\n      directory: ${{ inputs.directory }}\n',
			'.github/workflows/a.yml':
				"on: { push: { tags: ['v*'] } }\njobs:\n  start:\n    uses: ./.github/workflows/b.yml\n    with:\n      directory: packages/a\n",
		}, 60);
		expect(nestedScripts.files['packages/a/scripts/publish.sh']).toBe('npm publish\n');
		const compositeScripts = await built({
			...workspace,
			'packages/a/scripts/publish.sh': 'npm publish\n',
			'actions/publish/action.yml':
				'inputs:\n  directory:\n    required: true\nruns:\n  using: composite\n  steps:\n    - shell: bash\n      working-directory: ${{ inputs.directory }}\n      run: bash scripts/publish.sh\n',
			'.github/workflows/release.yml': release(
				'      - uses: ./actions/publish\n        with:\n          directory: packages/a\n',
			),
		}, 63);
		expect(compositeScripts.files['packages/a/scripts/publish.sh']).toBe('npm publish\n');
		expect(selected(
			{
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release(
					'      - working-directory: packages/a\n        run: npm --prefix ../b publish\n',
				),
			},
			64,
			'npm',
		)).toEqual(['pkg:npm/b']);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', scripts: { release: 'npm publish' } }),
				'.github/workflows/release.yml': release('      - run: pnpm release\n'),
			},
			65,
			'npm',
		)).toEqual(['pkg:npm/root-tool']);
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/a", "crates/b"]\n',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'crates/b/Cargo.toml': '[package]\nname = "b"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release(
					'      - run: cargo publish --workspace --manifest-path crates/a/Cargo.toml\n',
				),
			},
			66,
			'crates-io',
		)).toEqual(['pkg:cargo/a', 'pkg:cargo/b']);
		const rootTool = { 'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }) };
		expect(
			planned({
				...rootTool,
				'.github/workflows/release.yml': release('      - run: echo "To release, run npm publish"\n'),
			}, 67).graph.streams,
		).toEqual([]);
		expect(selected(
			{
				...rootTool,
				'.github/workflows/release.yml': release('      - run: echo "$(npm publish)"\n'),
			},
			68,
			'npm',
		)).toEqual(['pkg:npm/root-tool']);
		expect(selected(
			{
				...rootTool,
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/a/publish.sh': 'npm publish\n',
				'packages/a/action.yml':
					'runs:\n  using: composite\n  steps:\n    - shell: bash\n      working-directory: ${{ github.action_path }}\n      run: bash publish.sh\n',
				'.github/workflows/release.yml': release('      - uses: ./packages/a\n'),
			},
			69,
			'npm',
		)).toEqual(['pkg:npm/a']);
		const publishing = (name: string) =>
			JSON.stringify({ name, version: '1.0.0', scripts: { release: 'npm publish' } });
		expect(selected(
			{
				'package.json': JSON.stringify({
					name: 'root-tool',
					version: '1.0.0',
					workspaces: ['packages/*'],
					scripts: { release: 'npm publish' },
				}),
				'packages/a/package.json': publishing('a'),
				'.github/workflows/release.yml': release(
					'      - run: npm run release --workspaces --include-workspace-root\n',
				),
			},
			70,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/root-tool']);
		expect(
			planned({
				'Cargo.toml': '[package]\nname = "widget"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release('      - run: cargo publish --registry private\n'),
			}, 71).graph.streams,
		).toEqual([]);
		expect(selected(
			{
				'Cargo.toml': '[package]\nname = "widget"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release('      - run: cargo publish --registry crates-io\n'),
			},
			72,
			'crates-io',
		)).toEqual(['pkg:cargo/widget']);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				Makefile: 'release:\n\tcd packages/a && npm publish\n\tcd packages/b && npm publish\n',
				'.github/workflows/release.yml': release('      - run: make release\n'),
			},
			73,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		const extensionJob = (id: string, tag: string, directory: string) =>
			`  ${id}:\n    runs-on: ubuntu-latest\n    if: startsWith(github.ref, 'refs/tags/${tag}')\n    steps:\n      - working-directory: ${directory}\n        run: npx vsce publish\n`;
		const extensionPackage = (name: string) =>
			JSON.stringify({ name, version: '1.0.0', publisher: 'acme', engines: { vscode: '^1.90.0' } });
		const perJob = planned({
			'ext/a/package.json': extensionPackage('a'),
			'ext/b/package.json': extensionPackage('b'),
			'.github/workflows/release.yml': `on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n${
				extensionJob('a', 'a-v', 'ext/a')
			}${extensionJob('b', 'b-v', 'ext/b')}`,
		}, 74);
		expect(
			perJob.graph.streams.flatMap(proposal =>
				proposal.targets.filter(entry => entry.destination === 'vscode-marketplace').map(entry => entry.sources)
			),
		).toContainEqual({
			'release.yml#a': ['pkg:vscode-extension/acme/a'],
			'release.yml#b': ['pkg:vscode-extension/acme/b'],
		});
		const configured = (registry: string, id: number) =>
			planned({
				'package.json': JSON.stringify({ name: 'widget', version: '1.0.0', publishConfig: { registry } }),
				'.github/workflows/release.yml': release('      - run: npm publish\n'),
			}, id);
		const github = configured('https://npm.pkg.github.com', 75);
		expect(target(stream(github.graph, 'main'), 'npm').packages).toEqual([]);
		expect(github.choices.flatMap(choice => choice.required)).toEqual([]);
		expect(
			target(stream(configured('https://registry.npmjs.org/', 76).graph, 'main'), 'npm').packages,
		).toEqual(['pkg:npm/widget']);
		expect(selected(
			{
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release(
					'      - working-directory: packages/a\n        run: npm publish ../b\n',
				),
			},
			77,
			'npm',
		)).toEqual(['pkg:npm/b']);
		expect(selected(
			{
				'Cargo.toml':
					'[package]\nname = "root-crate"\nversion = "1.0.0"\n\n[workspace]\nmembers = ["crates/a"]\ndefault-members = ["crates/a"]\n',
				'src/lib.rs': '',
				'crates/a/Cargo.toml': '[package]\nname = "a"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release('      - run: cargo publish\n'),
			},
			78,
			'crates-io',
		)).toEqual(['pkg:cargo/a']);
		const releasing = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0', scripts: { release: 'npm publish' } }),
		};
		expect(
			planned({
				...releasing,
				'.github/workflows/release.yml': release(
					'      - run: echo "To release, run npm run release -- --tag latest"\n',
				),
			}, 79).graph.streams,
		).toEqual([]);
		expect(selected(
			{
				...releasing,
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm run release -- ./packages/a\n'),
			},
			80,
			'npm',
		)).toEqual(['pkg:npm/a']);
		const guarded = planned({
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - if: startsWith(github.ref, 'refs/tags/a-v')\n        working-directory: packages/a\n        run: npm publish\n      - if: startsWith(github.ref, 'refs/tags/b-v')\n        working-directory: packages/b\n        run: npm publish\n",
		}, 81);
		const bindings = guarded.choices.flatMap(choice => choice.observe ?? []);
		expect(bindings.find(binding => binding.ref === 'refs/tags/a-v*')?.publications).toEqual(['pkg:npm/a']);
		expect(bindings.find(binding => binding.ref === 'refs/tags/b-v*')?.publications).toEqual(['pkg:npm/b']);
		const asked: string[] = [];
		const releaseFiles: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.2.0' }),
			'.github/workflows/release.yml':
				'on: { release: { types: [published] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n',
		};
		const releaseSnapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 82, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(releaseFiles).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(releaseFiles[path] ?? null),
			tags: prefixes => {
				asked.push(...prefixes);
				return Effect.succeed(prefixes.includes('') ? ['widget-v1.2.0'] : []);
			},
		}));
		expect(asked).toContain('');
		expect(releaseSnapshot.tags).toEqual(['widget-v1.2.0']);
		expect(selected(
			{
				'Cargo.toml': '[workspace]\nmembers = ["crates/public-tool", "crates/internal-tool"]\n',
				'crates/public-tool/Cargo.toml': '[package]\nname = "public-tool"\nversion = "1.0.0"\n',
				'crates/internal-tool/Cargo.toml': '[package]\nname = "internal-tool"\nversion = "1.0.0"\n',
				'.github/workflows/release.yml': release("      - run: cargo publish --workspace --exclude 'internal-*'\n"),
			},
			83,
			'crates-io',
		)).toEqual(['pkg:cargo/public-tool']);
		const composed = planned({
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'actions/publish/action.yml':
				"runs:\n  using: composite\n  steps:\n    - if: startsWith(github.ref, 'refs/tags/a-v')\n      shell: bash\n      working-directory: packages/a\n      run: npm publish\n    - if: startsWith(github.ref, 'refs/tags/b-v')\n      shell: bash\n      working-directory: packages/b\n      run: npm publish\n",
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./actions/publish\n",
		}, 84);
		const composedBindings = composed.choices.flatMap(choice => choice.observe ?? []);
		expect(composedBindings.find(binding => binding.ref === 'refs/tags/a-v*')?.publications).toEqual(['pkg:npm/a']);
		expect(composedBindings.find(binding => binding.ref === 'refs/tags/b-v*')?.publications).toEqual(['pkg:npm/b']);
		const guardedPrefix = planned({
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - if: startsWith(github.ref, 'refs/tags/a-v')\n        run: npm --prefix packages/a publish\n      - if: startsWith(github.ref, 'refs/tags/b-v')\n        run: npm --prefix packages/b publish\n",
		}, 85);
		const guardedPrefixBindings = guardedPrefix.choices.flatMap(choice => choice.observe ?? []);
		expect(guardedPrefixBindings.find(binding => binding.ref === 'refs/tags/a-v*')?.publications).toEqual([
			'pkg:npm/a',
		]);
		expect(guardedPrefixBindings.find(binding => binding.ref === 'refs/tags/b-v*')?.publications).toEqual([
			'pkg:npm/b',
		]);
		const helperFiles: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'scripts/publish.sh': 'npm publish\n',
			'actions/publish/action.yml':
				"runs:\n  using: composite\n  steps:\n    - if: startsWith(github.ref, 'refs/tags/a-v')\n      shell: bash\n      run: bash scripts/publish.sh\n    - if: startsWith(github.ref, 'refs/tags/b-v')\n      shell: bash\n      run: bash scripts/publish.sh\n",
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./actions/publish\n",
		};
		const helperJob = workflowModels({
			repository: { id: 86, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: helperFiles,
			paths: Object.keys(helperFiles),
		}).flatMap(model => model.jobs).flatMap(job => job.effects).flatMap(effect =>
			effect.kind === 'publish' ? effect.condition ?? [] : []
		);
		expect(helperJob.some(condition => condition.includes('a-v'))).toBe(true);
		expect(helperJob.some(condition => condition.includes('b-v'))).toBe(true);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release(
					'      - working-directory: ${{ matrix.package.directory }}\n        run: npm publish\n',
					'    strategy:\n      matrix:\n        package:\n          - directory: packages/a\n          - directory: packages/b\n',
				),
			},
			87,
			'npm',
		)).toEqual(['pkg:npm/a', 'pkg:npm/b']);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', private: true }),
				'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'examples/demo/package.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: pnpm -r publish --no-git-checks\n'),
			},
			88,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				'package.json': JSON.stringify({
					name: 'root-tool',
					version: '1.0.0',
					private: true,
					scripts: { prepublishOnly: 'npm --prefix packages/b publish' },
				}),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish ./packages/a\n'),
			},
			89,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release(
					'      - run: |\n          (cd packages/a &&\n          npm publish\n          )\n',
				),
			},
			90,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(
			planned({
				'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: echo "Run tests && npm publish"\n'),
			}, 91).graph.streams,
		).toEqual([]);
		const callSites = planned({
			'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
			'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
			'.github/workflows/publish.yml':
				'on:\n  workflow_call:\n    inputs:\n      directory:\n        type: string\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - working-directory: ${{ inputs.directory }}\n        run: npm publish\n',
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  a:\n    if: startsWith(github.ref, 'refs/tags/a-v')\n    uses: ./.github/workflows/publish.yml\n    with: { directory: packages/a }\n  b:\n    if: startsWith(github.ref, 'refs/tags/b-v')\n    uses: ./.github/workflows/publish.yml\n    with: { directory: packages/b }\n",
		}, 92);
		const siteBindings = callSites.choices.flatMap(choice => choice.observe ?? []);
		expect(siteBindings.find(binding => binding.ref === 'refs/tags/a-v*')?.publications).toEqual(['pkg:npm/a']);
		expect(siteBindings.find(binding => binding.ref === 'refs/tags/b-v*')?.publications).toEqual(['pkg:npm/b']);
		const expressionFiles: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'actions/publish/publish.sh': 'npm publish\n',
			'actions/publish/action.yml':
				'runs:\n  using: composite\n  steps:\n    - if: startsWith(github.ref, \'refs/tags/a-v\')\n      shell: bash\n      run: bash "${{ github.action_path }}/publish.sh"\n',
			'.github/workflows/release.yml':
				"on: { push: { tags: ['a-v*', 'b-v*'] } }\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./actions/publish\n",
		};
		const expressionEffects = workflowModels({
			repository: { id: 93, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: expressionFiles,
			paths: Object.keys(expressionFiles),
		}).flatMap(model => model.jobs).flatMap(job => job.effects).flatMap(effect =>
			effect.kind === 'publish' ? [effect] : []
		);
		expect(expressionEffects.length).toBeGreaterThan(0);
		expect(expressionEffects.every(effect => effect.condition?.includes('a-v'))).toBe(true);
		const wide = Array.from({ length: 65 }, (_, index) => `packages/p${index}`);
		expect(
			selected(
				{
					'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0', private: true }),
					...Object.fromEntries(
						wide.map(
							directory => [
								`${directory}/package.json`,
								JSON.stringify({ name: directory.slice(9), version: '1.0.0' }),
							],
						),
					),
					'.github/workflows/release.yml': release(
						'      - working-directory: ${{ matrix.directory }}\n        run: npm publish\n',
						`    strategy:\n      matrix:\n        directory: [${wide.join(', ')}]\n`,
					),
				},
				94,
				'npm',
			).length,
		).toBe(65);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'root-tool', version: '1.0.0' }),
				'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
				'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
				'.github/workflows/release.yml': release(
					"      - run: |\n          (cd packages/a &&\n          VERSION=$(printf '1.0.0') &&\n          npm publish\n          )\n",
				),
			},
			95,
			'npm',
		)).toEqual(['pkg:npm/a']);
		expect(
			planned({
				'package.json': JSON.stringify({ name: '@octo/tool', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish --registry https://npm.pkg.github.com\n'),
			}, 61).graph.streams,
		).toEqual([]);
		expect(selected(
			{
				'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
				'.github/workflows/release.yml': release('      - run: npm publish --registry https://registry.npmjs.org\n'),
			},
			62,
			'npm',
		)).toEqual(['pkg:npm/tool']);
		const goModule = planned({
			'v2/go.mod': 'module github.com/octo/mono/v2\n\ngo 1.22\n',
			'.github/workflows/release.yml': release('      - run: gh release create "$GITHUB_REF_NAME" dist/*\n'),
		}, 48);
		expect(target(stream(goModule.graph, 'main'), 'go-proxy').packages).toEqual([
			'pkg:golang/github.com/octo/mono/v2',
		]);
		const extension = {
			'package.json': JSON.stringify({
				name: 'tool',
				version: '1.0.0',
				publisher: 'acme',
				engines: { vscode: '^1.90.0' },
			}),
		};
		const registries = (run: string, id: number) =>
			planned({
				...extension,
				'.github/workflows/release.yml': release(run),
			}, id).choices[0]?.observe?.map(binding => binding.publications);
		expect(registries('      - run: npx ovsx publish\n', 36)).toEqual([[]]);
		expect(registries('      - run: npx vsce publish\n      - run: npx ovsx publish\n', 37)).toEqual([[
			'pkg:vscode-extension/acme/tool',
		]]);
		const families = {
			'packages/core/package.json': JSON.stringify({ name: 'core', version: '1.0.0' }),
			'packages/cli/package.json': JSON.stringify({ name: 'cli', version: '2.0.0' }),
			'.github/workflows/release.yml': [
				"on: { push: { tags: ['core-v*', 'cli-v*'] } }",
				'jobs:',
				'  core:',
				"    if: startsWith(github.ref, 'refs/tags/core-v')",
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/core && npm publish',
				'  cli:',
				"    if: startsWith(github.ref, 'refs/tags/cli-v')",
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cd packages/cli && npm publish',
				'',
			].join('\n'),
		};
		expect(planned(families, 25).choices[0]?.observe?.map(binding => [binding.ref, binding.publications])).toEqual([
			['refs/tags/core-v*', ['pkg:npm/core']],
			['refs/tags/cli-v*', ['pkg:npm/cli']],
		]);
	});

	test('runner flag lists parse in linear time and TestPyPI is matched by host', () => {
		const flags = ` ${'-import '.repeat(5000)}x`;
		const started = performance.now();
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", `node${flags} scripts/release.js`),
			'.github/workflows/deno.yml': workflow("{ push: { tags: ['w*'] } }", `deno run${' -.json '.repeat(5000)}x`),
		};
		plan({
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(performance.now() - started).toBeLessThan(2_000);
		const py = (url: string): Record<string, string> => ({
			'pyproject.toml': '[project]\nname = "tool"\nversion = "1.0.0"\n',
			'.github/workflows/release.yml':
				`on: { push: { branches: [main] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: pypa/gh-action-pypi-publish@release/v1\n        with: { repository-url: "${url}" }\n`,
		});
		const kinds = (url: string) => {
			const input = py(url);
			return plan({
				repository: { id: 2, name: 'octo/tool', defaultBranch: 'main' },
				sha: 'a'.repeat(40),
				files: input,
				paths: Object.keys(input),
			}).graph.streams.flatMap(proposal => proposal.targets.map(entry => entry.destination));
		};
		expect(kinds('https://test.pypi.org/legacy/')).toEqual([]);
		expect(kinds('https://test.pypi.org.evil.example/legacy/')).toEqual(['pypi']);
	});

	test('workspace lockstep needs matching file versions', () => {
		const files: Record<string, string> = {
			'Cargo.toml': '[workspace]\nmembers = ["a", "b"]\n[workspace.package]\nversion = "1.0.0"\n',
			'a/Cargo.toml': '[package]\nname = "a"\nversion.workspace = true\n',
			'b/Cargo.toml': '[package]\nname = "b"\nversion = "0.3.0"\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'cargo publish --workspace'),
		};
		const { choices, graph } = plan({
			repository: { id: 1, name: 'octo/crates', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(stream(graph, 'main').versionGroup.lockstep).toBe('conflicting');
		expect(choices[0]?.versioning).toBe('independent');
	});

	test('a local action runs only its own manifest', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'actions/build/action.yml': 'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: echo build\n',
			'actions/build/unused/action.yml':
				'runs:\n  using: composite\n  steps:\n    - shell: bash\n      run: npm publish\n',
			'.github/workflows/ci.yml':
				'on: { push: { branches: [main] } }\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./actions/build\n',
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(graph.streams).toEqual([]);
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(files[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(Object.keys(snapshot.files)).toContain('actions/build/action.yml');
		expect(Object.keys(snapshot.files)).not.toContain('actions/build/unused/action.yml');
	});

	test('rehearsals, PyPI working directories and mise task scripts', async () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'widget', version: '1.0.0' }),
			'Cargo.toml': '[package]\nname = "widget"\nversion = "1.0.0"\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'npm publish --dry-run=false'),
			'.github/workflows/check.yml': [
				'on: { push: { branches: [main] }, workflow_dispatch: {} }',
				'jobs:',
				'  check:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - run: cargo publish -n',
				'      - uses: JS-DevTools/npm-publish@v3',
				'        with: { dry-run: true }',
				'',
			].join('\n'),
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(graph.streams.map(proposal => proposal.workflows.map(entry => entry.file))).toEqual([['release.yml']]);
		expect(destinations(stream(graph, 'main'))).toEqual(['npm']);
		const python: Record<string, string> = {
			'pyproject.toml': '[project]\nname = "other"\nversion = "1.0.0"\n',
			'packages/python/pyproject.toml': '[project]\nname = "quill"\nversion = "1.0.0"\n',
			'.github/workflows/publish.yml': [
				"on: { push: { tags: ['v*'] } }",
				'jobs:',
				'  publish:',
				'    runs-on: ubuntu-latest',
				'    steps:',
				'      - working-directory: packages/python',
				'        run: uv build && uv publish',
				'',
			].join('\n'),
		};
		const pypi = plan({
			repository: { id: 2, name: 'octo/python', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files: python,
			paths: Object.keys(python),
		});
		expect(target(stream(pypi.graph, 'main'), 'pypi').packages).toEqual(['pkg:pypi/quill']);
		const mise: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			'mise.toml': '[tasks.release]\nrun = "bash scripts/publish.sh"\n',
			'scripts/publish.sh': '#!/bin/sh\nnpm publish\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'mise run release'),
		};
		const snapshot = await Effect.runPromise(buildSnapshot({
			repository: { id: 3, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: Object.keys(mise).map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path => Effect.succeed(mise[path] ?? null),
			tags: () => Effect.succeed([]),
		}));
		expect(snapshot.files['scripts/publish.sh']).toBe(mise['scripts/publish.sh']);
		expect(target(stream(plan(snapshot).graph, 'main'), 'npm').names).toEqual(['tool']);
	});

	test('make prerequisites reach the publishing recipe', () => {
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'tool', version: '1.0.0' }),
			Makefile: 'release: build publish\n\nbuild:\n\techo build\n\npublish:\n\tnpm publish\n',
			'.github/workflows/release.yml': workflow("{ push: { tags: ['v*'] } }", 'make release'),
		};
		const { graph } = plan({
			repository: { id: 1, name: 'octo/tool', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			files,
			paths: Object.keys(files),
		});
		expect(target(stream(graph, 'main'), 'npm').names).toEqual(['tool']);
	});

	test('observe bindings follow each workflow trigger', async () => {
		const actionlint = await load('actionlint');
		const main = actionlint.choices.find(choice => choice.name === 'actionlint');
		expect(main?.observe?.find(binding => binding.file === 'release.yml')?.ref).toBe('refs/tags/v*');
		expect(main?.observe?.find(binding => binding.file === 'release.yml')?.publications).toEqual([
			'pkg:github/kjanat/actionlint',
			'pkg:npm/%40kjanat/actionlint',
		]);
		const prepare = main?.observe?.find(binding => binding.file === 'release-prepare.yml');
		expect(prepare?.ref).toBeUndefined();
		expect(prepare?.publications).toEqual([]);
		const nightly = main?.observe?.find(binding => binding.file === 'docker-nightly.yml');
		expect(nightly?.ref).toBeUndefined();
		expect(nightly?.publications).toEqual([]);
	});

	test('every fixture explains its groupings and omissions deterministically', async () => {
		const names = (await Array.fromAsync(
			new Bun.Glob('*.json').scan(new URL('../fixtures/repositories/', import.meta.url).pathname),
		))
			.map(file => file.replace(/\.json$/, '')).sort();
		expect(names).toHaveLength(26);
		for (const name of names) {
			const snapshot = await snapshotOf(name);
			const first = plan(snapshot), second = plan(snapshot);
			expect(second.markdown).toBe(first.markdown);
			expect(second.choices).toEqual(first.choices);
			expect(first.markdown).toStartWith('## Release plan');
			for (const proposal of first.graph.streams) {
				expect(proposal.evidence.length).toBeGreaterThan(0);
				expect(first.markdown).toContain(`### Stream \`${proposal.id}\``);
			}
			for (const omission of first.graph.omissions) {
				expect(first.markdown).toContain(`- ${omission.subject}: ${omission.reason}.`);
			}
			for (const choice of first.choices) {
				const bindings = choice.observe ?? [];
				expect(new Set(bindings.map(binding => binding.name)).size).toBe(bindings.length);
				expect(new Set(bindings.map(binding => `${binding.file} ${binding.ref ?? ''}`)).size).toBe(bindings.length);
			}
		}
	});
});

describe('adoption PR', () => {
	let world: World;
	beforeEach(async () => {
		world = await World.create();
	});
	afterEach(() => world.dispose());

	test('a simple plugin release is adopted without entering workflows, and regenerates identically', async () => {
		const { snapshot } = await load('dprint-plugin-svg');
		const repository = world.github.create(snapshot.repository.name, snapshot.files, snapshot.repository.defaultBranch);
		const api = bearer(world, await world.cliSession());
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
		expect(preview.status).toBe(200);
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		expect(plan.choices.streams).toEqual([{
			name: 'main',
			packages: [],
			versioning: 'workspace',
			required: [],
			versionSource: { kind: 'tags', prefix: 'v' },
			observe: [{ name: 'release', file: 'release.yml', ref: 'refs/tags/v*', publications: [] }],
		}]);
		expect(plan.adoption?.join('\n')).toContain('### Stream `main`');
		expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
		expect(applied.status).toBe(200);
		expect(repository.pulls).toHaveLength(1);
		expect(repository.pulls[0]?.body).toContain('## Release plan');
		const configuration = world.github.file(repository, '.github/beepboop.json', repository.pulls[0]?.head.ref);
		expect(configuration).toContain('"mode": "observe"');
		const again = await api('/api/repositories/setup/preview', { repository: repository.name });
		const next = await Effect.runPromise(parseSetupPlan(again.body));
		expect(next.choices).toEqual(plan.choices);
		expect(next.edits).toEqual(plan.edits);
		expect(next.adoption).toEqual(plan.adoption);
	});
});
