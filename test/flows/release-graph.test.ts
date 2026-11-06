import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import { discover } from '@/automation/managers';
import { buildSnapshot } from '@/automation/snapshot';
import { adoptionChoices, adoptionMarkdown } from '@/automation/release-graph/adoption';
import {
	inferReleaseGraph,
	type ReleaseGraph,
	type StreamProposal,
	type Target,
} from '@/automation/release-graph/graph';
import type { Destination } from '@/automation/release-graph/workflows';
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

	test('observe bindings follow each workflow trigger', async () => {
		const actionlint = await load('actionlint');
		const main = actionlint.choices.find(choice => choice.name === 'actionlint');
		expect(main?.observe?.find(binding => binding.file === 'release.yml')?.ref).toBe('refs/tags/v*');
		expect(main?.observe?.find(binding => binding.file === 'release-prepare.yml')?.ref).toBeUndefined();
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
