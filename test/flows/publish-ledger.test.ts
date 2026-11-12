import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, Runner } from '@root/actions/runtime/publish.ts';
import {
	distributionLicensed,
	main,
	publicRepository,
	publishPackages,
	pythonMissing,
	requireAll,
} from '@root/actions/runtime/publish.ts';
import { begin, runIdentity } from '@root/test/support/actions.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { Repository } from '@root/test/support/github.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer } from '@root/test/support/http.ts';
import type { Publishing } from '@root/test/support/ledger.ts';
import {
	cargoMetadata,
	crateBytes,
	crateChecksum,
	crateFields,
	crateListing,
	packCrate,
	publishWith,
	withIdentity,
	workflowCall,
} from '@root/test/support/ledger.ts';
import { silenced } from '@root/test/support/process.ts';
import { crateResponse, npmIntegrity, pypiResponse } from '@root/test/support/registries.ts';
import { promotions } from '@root/test/support/releases.ts';
import {
	crateMetadata,
	dispatchedPublishWorkflow,
	licenseText,
	npmManifest,
	npmMetadata,
	passChecks,
	pythonMetadata,
} from '@root/test/support/repositories.ts';
import type { RunIdentity, World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { ledgerSchema } from '@/automation/ledger';
import { publishMinutes } from '@/automation/setup-workflows';
import type { Execution } from '@/automation/types';
import { publishWaitMinutes } from '@/contract/ledger';

let world: World;
let target = '';
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-target-', created => {
	target = created;
});

const ledgerWorkflow = (stream: string) =>
	dispatchedPublishWorkflow(
		`Publish ${stream}`,
		stream,
		'beepboop',
		`      - uses: kjanat/beepboop/actions/publish@actions
        with:
          execution-id: \${{ steps.beepboop.outputs.execution-id }}
          credentials: '{"CARGO_REGISTRY_TOKEN":"crates-io"}'
`,
	);

const core = 'pkg:cargo/lint-core', cli = 'pkg:cargo/lint';
const manifests: Record<string, string> = {
	'crates/core/Cargo.toml': 'lint-core',
	'crates/cli/Cargo.toml': 'lint',
};

function manifestsAt(version: string): Record<string, string> {
	return {
		'crates/core/Cargo.toml': `[package]\nname = "lint-core"\nversion = "${version}"\n${crateMetadata}`,
		'crates/cli/Cargo.toml':
			`[package]\nname = "lint"\nversion = "${version}"\n${crateMetadata}\n[dependencies]\nlint-core = { path = "../core", version = "${version}" }\n`,
	};
}

interface Layout {
	managers: string[];
	secrets: Record<string, string>;
	files(version: string): Record<string, string>;
}
const cargoLayout: Layout = {
	managers: ['cargo', 'workflow'],
	secrets: { 'crates-io': 'crates-secret' },
	files: version => ({
		'Cargo.toml': '[workspace]\nmembers = ["crates/core", "crates/cli"]\n',
		'Cargo.lock': '# Lockfile\n',
		'README.md': '# lint\n',
		LICENSE: licenseText,
		...manifestsAt(version),
	}),
};
const bindingsLayout: Layout = {
	managers: ['npm', 'pypi', 'workflow'],
	secrets: { 'npm-token': 'npm-secret', 'pypi-token': 'pypi-secret' },
	files: version => ({
		'bindings/js/package.json': npmManifest('@octo/lint', version),
		'bindings/js/README.md': '# lint\n',
		'bindings/js/LICENSE': licenseText,
		'bindings/python/LICENSE': licenseText,
		'bindings/python/pyproject.toml': `[project]\nname = "lint-py"\nversion = "${version}"\n${pythonMetadata}`,
	}),
};

function stream(name: string, packages: string[], layout: Layout) {
	return {
		packages,
		required: packages,
		credentials: Object.keys(layout.secrets),
		prepare: { strategy: 'managed' },
		promote: { approval: 'push', workflow: { file: `publish-${name}.yml`, publications: packages } },
	};
}

function repositoryWith(layout: Layout, streams: Record<string, string[]>): Repository {
	const files: Record<string, string> = {
		...layout.files('1.0.0'),
		'.github/beepboop.json': JSON.stringify({
			managers: layout.managers,
			streams: Object.fromEntries(
				Object.entries(streams).map(([name, packages]) => [name, stream(name, packages, layout)]),
			),
		}),
	};
	for (const name of Object.keys(streams)) files[`.github/workflows/publish-${name}.yml`] = ledgerWorkflow(name);
	const repository = world.github.create('octo/lint', files);
	passChecks(repository, world.github.head(repository));
	return repository;
}

const registry = new Map<string, string>();
let registryDown = 0, registryLag = 0;
function serveCrates() {
	registry.clear();
	registryDown = 0;
	registryLag = 0;
	registry.set('lint-core@1.0.0', 'c'.repeat(64));
	registry.set('lint@1.0.0', 'c'.repeat(64));
	world.network.serve('crates.io', request =>
		crateResponse(request, (name, version) => {
			if (registryDown > 0) {
				registryDown--;
				return new Response(null, { status: 503 });
			}
			const checksum = registry.get(`${name}@${version}`);
			if (checksum && registryLag > 0) {
				registryLag--;
				return new Response(null, { status: 404 });
			}
			return checksum;
		}));
}

function checksum(name: string, version: string) {
	return createHash('sha256').update(crateBytes(name, version)).digest('hex');
}

interface Cargo {
	commands: { command: string; token?: string }[];
	outcomes: Record<string, string[]>;
	broken?: string[];
	stripped?: Record<string, string[]>;
}
function cargo(state: Cargo) {
	return (argv: string[], options: { cwd: string; env?: Record<string, string> }) =>
		Effect.sync((): Command => {
			const manifest = argv[argv.indexOf('--manifest-path') + 1] ?? '';
			const name = manifests[manifest] ?? 'unknown';
			const listing = argv[1] === 'package' && argv[2] === '--list';
			state.commands.push({
				command: `${listing ? 'package --list' : argv[1]} ${name}`,
				...(options.env?.CARGO_REGISTRY_TOKEN ? { token: options.env.CARGO_REGISTRY_TOKEN } : {}),
			});
			if (argv[1] === 'metadata') return cargoMetadata(target);
			if (listing) return crateListing(state.stripped?.[name]);
			if (argv[1] === 'package') {
				if (state.broken?.includes(name)) {
					return {
						code: 101,
						stdout: `error: failed to verify package ${name}`,
						output: `error: failed to verify package ${name}`,
					};
				}
				packCrate(target, name, '1.1.0');
				return { code: 0, stdout: `Packaged ${name}`, output: `Packaged ${name}` };
			}
			const outcome = state.outcomes[name]?.shift() ?? 'ok';
			const sum = crateChecksum(target, name, '1.1.0');
			if (outcome === 'ok') {
				registry.set(`${name}@1.1.0`, sum);
				return { code: 0, stdout: `Uploaded ${name}`, output: `Uploaded ${name}` };
			}
			if (outcome === 'late') {
				registry.set(`${name}@1.1.0`, sum);
				return {
					code: 101,
					stdout: `error: timed out waiting for ${name}`,
					output: `error: timed out waiting for ${name}`,
				};
			}
			if (outcome === 'unlisted') return { code: 0, stdout: `Uploaded ${name}`, output: `Uploaded ${name}` };
			if (outcome === 'tomorrow') {
				return {
					code: 101,
					stdout: '',
					output: 'error: (status 429 Too Many Requests): Please try again after Tue, 10 Nov 2026 10:00:00 GMT',
				};
			}
			if (outcome === '429') {
				return {
					code: 101,
					stdout: '',
					output:
						'error: the remote server responded with an error (status 429 Too Many Requests): Please try again after Mon, 09 Nov 2026 10:00:00 GMT',
				};
			}
			return { code: 101, stdout: `error: could not compile ${name}`, output: `error: could not compile ${name}` };
		});
}

function fakeCargo(bin: string, trace: string, metadata: string): void {
	writeFileSync(
		join(bin, 'cargo'),
		`#!/usr/bin/env bash
${trace}case "$1 $2" in
  metadata*)${metadata}printf '{"target_directory":"%s","packages":[%s]}\\n' "$TARGET" '${
		JSON.stringify({ name: 'lint-core', ...crateFields })
	}' ;;
  "package --list") printf 'Cargo.toml\\nLICENSE\\nREADME.md\\nsrc/lib.rs\\n' ;;
  package*) mkdir -p "$TARGET/package"; printf 'lint-core 1.1.0\\n' > "$TARGET/package/lint-core-1.1.0.crate"; echo packaged ;;
  publish*) echo "error: crates.io rejected lint-core" >&2; exit 101 ;;
esac
`,
	);
	chmodSync(join(bin, 'cargo'), 0o755);
}

function publishing(identity: RunIdentity, executionId: string, options: Cargo | Omit<Publishing, 'scratch'>) {
	return publishWith(
		world,
		identity,
		executionId,
		'run' in options
			? { ...options, scratch: target }
			: { run: cargo(options), scratch: target, credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' } },
	);
}

async function grant(
	api: (path: string, body?: unknown) => Promise<Reply>,
	repository: Repository,
	streams: string[],
	secrets: Record<string, string>,
) {
	for (const [alias, value] of Object.entries(secrets)) {
		await world.elevate();
		expect((await api('/api/credentials/replace', { alias, value, proof: 'proof', expectedVersion: null })).status)
			.toBe(200);
		for (const name of streams) {
			await world.elevate();
			expect(
				(await api('/api/credentials/grant', {
					proof: 'proof',
					selection: { alias, repositoryId: repository.id, stream: name, operation: 'promote', delivery: 'runtime' },
				})).status,
			).toBe(200);
		}
	}
}

async function released(streams: Record<string, string[]>, layout = cargoLayout, version = '1.1.0') {
	serveCrates();
	const repository = repositoryWith(layout, streams);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await grant(api, repository, Object.keys(streams), layout.secrets);
	const merged = world.github.push(repository, layout.files(version), `Release ${version}`);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(60_000);
	const begun = new Map<string, { execution: Execution; identity: RunIdentity }>();
	for (const promotion of await promotions(api)) {
		const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion.id);
		if (!run) throw new Error(`No run for ${promotion.stream}: ${promotion.state} ${promotion.reason ?? ''}`);
		run.status = 'in_progress';
		const identity = runIdentity(repository, run, `publish-${promotion.stream}.yml`);
		await begin(world, identity, promotion.id, promotion.stream, 'promote');
		begun.set(promotion.stream, { execution: promotion, identity });
	}
	return { repository, api, begun };
}

function started(begun: Map<string, { execution: Execution; identity: RunIdentity }>, name: string) {
	const entry = begun.get(name);
	if (!entry) throw new Error(`No ${name} run`);
	return entry;
}

async function ledgerOf(repository: Repository, executionId: string) {
	const journal = await world.coordinator(repository).exportJournal();
	const value = journal.find(entry => entry.key === `ledger:${executionId}`)?.value;
	return ledgerSchema.parse(value);
}
async function executionOf(repository: Repository, executionId: string) {
	const execution = await world.coordinator(repository).execution(executionId);
	if (!execution) throw new Error('Missing execution');
	return execution;
}
function states(entries: { purl: string; state: string; error?: string }[]) {
	return entries.map(entry => [entry.purl, entry.state, ...(entry.error ? [entry.error] : [])]);
}

test('the ledger publishes crates in dependency order and hands the token only to the publish command', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {} };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'published'],
		['pkg:cargo/lint@1.1.0', 'published'],
	]);
	expect(state.commands).toEqual([
		{ command: 'metadata lint-core' },
		{ command: 'package --list lint-core' },
		{ command: 'package lint-core' },
		{ command: 'publish lint-core', token: 'crates-secret' },
		{ command: 'metadata lint' },
		{ command: 'package --list lint' },
		{ command: 'package lint' },
		{ command: 'publish lint', token: 'crates-secret' },
	]);
	const recorded = await executionOf(repository, execution.id);
	expect(recorded.publications.map(p => [p.id, p.version, p.outcome, p.digest])).toEqual([
		[core, '1.1.0', 'succeeded', checksum('lint-core', '1.1.0')],
		[cli, '1.1.0', 'succeeded', checksum('lint', '1.1.0')],
	]);
	const ledger = await ledgerOf(repository, execution.id);
	expect(ledger.records.map(record => [record.purl, record.dependencies, record.reservation])).toEqual([
		['pkg:cargo/lint-core@1.1.0', [], 'update'],
		['pkg:cargo/lint@1.1.0', [core], 'update'],
	]);
	expect(ledger.records.map(record => record.attempts.map(attempt => attempt.event))).toEqual([
		['claimed', 'published'],
		['claimed', 'published'],
	]);

	const run = repository.runs.find(entry => entry.id === identity.runId);
	if (!run) throw new Error('Missing run');
	run.status = 'completed';
	run.conclusion = 'success';
	await world.workflowRun(repository, run, 'success', 'workflow_dispatch');
	await world.wait(2_000);
	expect((await executionOf(repository, execution.id)).state).toBe('succeeded');
}, 60_000);

test('a crate crates.io already has with the same checksum is reused without publishing', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	registry.set('lint-core@1.1.0', checksum('lint-core', '1.1.0'));
	const state: Cargo = { commands: [], outcomes: {} };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'reused'],
		['pkg:cargo/lint@1.1.0', 'published'],
	]);
	expect(state.commands.map(entry => entry.command)).not.toContain('publish lint-core');
	expect((await executionOf(repository, execution.id)).publications.map(p => p.outcome)).toEqual([
		'succeeded',
		'succeeded',
	]);
}, 60_000);

test('a different crate on crates.io fails permanently and its dependent never publishes', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	registry.set('lint-core@1.1.0', 'f'.repeat(64));
	const state: Cargo = { commands: [], outcomes: {} };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'failed-permanent', 'crates.io has a different lint-core 1.1.0'],
		['pkg:cargo/lint@1.1.0', 'failed-retryable', 'pkg:cargo/lint-core did not publish'],
	]);
	expect(state.commands.map(entry => entry.command).filter(command => command.startsWith('publish'))).toEqual([]);
	expect((await executionOf(repository, execution.id)).publications.map(p => [p.id, p.outcome])).toEqual([
		[core, 'failed'],
		[cli, 'failed'],
	]);
}, 60_000);

test('a rate limited crate waits for Retry-After, defers the crates.io budget and then publishes', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	world.advance(Date.parse('2026-11-09T09:58:00.000Z') - Date.now());
	const state: Cargo = { commands: [], outcomes: { 'lint-core': ['429', 'ok'] } };
	const { result, logs } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'published'],
		['pkg:cargo/lint@1.1.0', 'published'],
	]);
	expect(logs).toContain('lint-core 1.1.0: rate-limited');
	expect(logs).toContain('crates.io rate limits lint-core 1.1.0 until 2026-11-09T10:00:00.000Z; waiting 120s');
	expect(state.commands.map(entry => entry.command).filter(command => command.startsWith('publish'))).toEqual([
		'publish lint-core',
		'publish lint-core',
		'publish lint',
	]);
	const ledger = await ledgerOf(repository, execution.id);
	expect(ledger.records[0]?.attempts.map(attempt => [attempt.event, attempt.detail])).toEqual([
		['claimed', undefined],
		['rate-limited', '2026-11-09T10:00:00.000Z'],
		['claimed', undefined],
		['published', undefined],
	]);
	const budget = await world.budgets.instance('crates-io').storage.get('arrival:update');
	expect(budget).toBeGreaterThanOrEqual(Date.parse('2026-11-09T10:00:00.000Z'));
}, 60_000);

test('a failed publish that crates.io lists anyway counts as published', async () => {
	const { begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: { 'lint-core': ['late'] } };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'published'],
		['pkg:cargo/lint@1.1.0', 'published'],
	]);
}, 60_000);

test('a failed publish stays retryable and the next run attempt publishes it', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: { 'lint-core': ['fail'] } };
	const first = await publishing(identity, execution.id, state);
	if (first.result._tag === 'Failure') throw new Error(first.result.failure.message);
	expect(states(first.result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'failed-retryable', 'error: could not compile lint-core'],
		['pkg:cargo/lint@1.1.0', 'failed-retryable', 'pkg:cargo/lint-core did not publish'],
	]);

	const run = repository.runs.find(entry => entry.id === identity.runId);
	if (!run) throw new Error('Missing run');
	run.attempt = 2;
	const retried = { ...identity, attempt: 2 };
	await begin(world, retried, execution.id, 'main', 'promote');
	const second = await publishing(retried, execution.id, state);
	if (second.result._tag === 'Failure') throw new Error(second.result.failure.message);
	expect(states(second.result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'published'],
		['pkg:cargo/lint@1.1.0', 'published'],
	]);
	expect((await executionOf(repository, execution.id)).publications.map(p => [p.id, p.outcome])).toEqual([
		[core, 'succeeded'],
		[cli, 'succeeded'],
	]);
}, 60_000);

test('crates.io errors never count as proof that a crate is missing', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	registryDown = 3;
	const state: Cargo = { commands: [], outcomes: {} };
	const { result, logs } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([['pkg:cargo/lint-core@1.1.0', 'published']]);
	expect(logs.filter(line => line.startsWith('crates.io could not confirm whether it has lint-core 1.1.0')))
		.toHaveLength(
			3,
		);
	expect(state.commands.map(entry => entry.command).filter(command => command.startsWith('publish'))).toEqual([
		'publish lint-core',
	]);
}, 60_000);

test('a stream waits in the ledger for the stream of the same commit that publishes its dependency', async () => {
	const { repository, begun } = await released({ main: [core], cli: [cli] });
	expect(world.github.dispatches.map(dispatch => dispatch.file).sort()).toEqual([
		'publish-cli.yml',
		'publish-main.yml',
	]);
	const main = started(begun, 'main'), dependent = started(begun, 'cli');
	const waiting = await withIdentity(world, dependent.identity, () =>
		Effect.runPromise(
			workflowCall(world, '/api/workflow/publish/next', { executionId: dependent.execution.id }),
		));
	expect(waiting).toEqual({
		kind: 'wait',
		until: Date.now() + 30_000,
		reason: 'lint 1.1.0 waits for pkg:cargo/lint-core',
	});

	const state: Cargo = { commands: [], outcomes: {} };
	const first = await publishing(main.identity, main.execution.id, state);
	if (first.result._tag === 'Failure') throw new Error(first.result.failure.message);
	expect(states(first.result.success)).toEqual([['pkg:cargo/lint-core@1.1.0', 'published']]);
	const second = await publishing(dependent.identity, dependent.execution.id, state);
	if (second.result._tag === 'Failure') throw new Error(second.result.failure.message);
	expect(states(second.result.success)).toEqual([['pkg:cargo/lint@1.1.0', 'published']]);
	expect((await executionOf(repository, dependent.execution.id)).publications.map(p => [p.id, p.outcome])).toEqual([
		[cli, 'succeeded'],
	]);
}, 60_000);

const pypi = new Map<string, string>();
function servePypi() {
	pypi.clear();
	pypi.set('lint-py@1.0.0', 'd'.repeat(64));
	world.network.serve('pypi.org', request =>
		pypiResponse(request, name => ({
			latest: '1.0.0',
			files: version => {
				const sha = pypi.get(`${name}@${version}`);
				return sha
					? [
						{ packagetype: 'bdist_wheel', yanked: false, digests: { sha256: 'b'.repeat(64) } },
						{ packagetype: 'sdist', yanked: false, digests: { sha256: sha } },
					]
					: undefined;
			},
		})));
}
const npm = '@octo/lint', python = 'lint-py';
function sdist(version: string) {
	return `lint-py ${version} sdist\n`;
}
function pkgInfo(version: string, readme: boolean) {
	return `Metadata-Version: 2.4\nName: lint-py\nVersion: ${version}\nSummary: A test project\nProject-URL: Repository, https://github.com/octo/example\nLicense-Expression: MIT\nDescription-Content-Type: text/plain\n${
		readme ? '\nA test project\n' : ''
	}`;
}
interface Bindings {
	commands: { command: string; cwd: string; env: Record<string, string> }[];
	empty?: boolean;
	limited?: number;
	stripped?: string[];
}
function bindings(state: Bindings, version: string): Runner['run'] {
	return (argv, options) =>
		Effect.sync((): Command => {
			const flags = argv.filter(arg => !arg.startsWith(target));
			state.commands.push({ command: flags.join(' '), cwd: options.cwd, env: options.env ?? {} });
			const after = (flag: string) => argv[argv.indexOf(flag) + 1] ?? '';
			if (argv[0] === 'uv' && argv[1] === 'build') {
				if (state.empty) return { code: 0, stdout: 'Built nothing', output: 'Built nothing' };
				writeFileSync(join(after('--out-dir'), `lint_py-${version}.tar.gz`), sdist(version));
				writeFileSync(join(after('--out-dir'), `lint_py-${version}-py3-none-any.whl`), 'wheel\n');
				return { code: 0, stdout: 'Successfully built', output: 'Successfully built' };
			}
			if (argv[0] === 'uv' && (state.limited ?? 0) > 0) {
				state.limited = (state.limited ?? 0) - 1;
				return {
					code: 2,
					stdout: 'error: Upload failed with status code 429 Too Many Requests\nRetry-After: 45',
					output: 'error: Upload failed with status code 429 Too Many Requests\nRetry-After: 45',
				};
			}
			if (argv[0] === 'uv') {
				pypi.set(`${python}@${version}`, createHash('sha256').update(sdist(version)).digest('hex'));
				return { code: 0, stdout: 'Uploading lint_py', output: 'Uploading lint_py' };
			}
			if (argv[0] === 'tar' && argv[3] === 'package/package.json') {
				const manifest = JSON.stringify({ name: npm, version, ...npmMetadata });
				return { code: 0, stdout: manifest, output: manifest };
			}
			if (argv[0] === 'tar' && argv[1] === '-tzf') {
				const listing = ['PKG-INFO', 'pyproject.toml', 'LICENSE'].filter(file => !state.stripped?.includes(file))
					.map(file => `lint_py-${version}/${file}\n`).join('');
				return { code: 0, stdout: listing, output: listing };
			}
			if (argv[0] === 'unzip') {
				const info = `lint_py-${version}.dist-info`;
				const listing = [
					'lint_py/__init__.py',
					`${info}/METADATA`,
					...(state.stripped?.includes('LICENSE') ? [] : [`${info}/licenses/LICENSE`]),
				].map(file => `${file}\n`).join('');
				return { code: 0, stdout: listing, output: listing };
			}
			if (argv[0] === 'tar') {
				const info = pkgInfo(version, !state.stripped?.includes('README.md'));
				return { code: 0, stdout: info, output: info };
			}
			if (argv[1] === 'pack') {
				writeFileSync(join(after('--pack-destination'), `octo-lint-${version}.tgz`), 'tarball\n');
				const files = ['package.json', 'LICENSE', 'README.md', 'index.js'].filter(path =>
					!state.stripped?.includes(path)
				)
					.map(path => ({ path }));
				const stdout = `> @octo/lint@${version} prepack\n> tsc\n\n${
					JSON.stringify(
						[{ filename: `octo-lint-${version}.tgz`, integrity: npmIntegrity(npm, version), files }],
						null,
						2,
					)
				}\n`;
				return { code: 0, stdout, output: `npm notice Tarball Contents\n${stdout}` };
			}
			world.npm.publish(npm, version, argv[argv.indexOf('--tag') + 1]);
			return { code: 0, stdout: `+ ${npm}@${version}`, output: `+ ${npm}@${version}` };
		});
}
const npmId = 'pkg:npm/%40octo/lint', pypiId = 'pkg:pypi/lint-py';
const bindingCredentials = { NODE_AUTH_TOKEN: 'npm-token', UV_PUBLISH_TOKEN: 'pypi-token' };

test('an npm upload receipt settles its claim without reading the registry', async () => {
	world.npm.publish(npm, '1.0.0');
	const { repository, begun } = await released({ main: [npmId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	await withIdentity(world, identity, async () => {
		const purl = `${npmId}@1.1.0`;
		const claimed = await Effect.runPromise(workflowCall(world, '/api/workflow/publish/claim', {
			executionId: execution.id,
			purl,
			digest: npmIntegrity(npm, '1.1.0'),
		}));
		expect(claimed).toMatchObject({ kind: 'publish' });
		world.network.serve('registry.npmjs.org', () => {
			throw new Error('Post-upload registry reads are forbidden');
		});
		const recorded = await Effect.runPromise(workflowCall(world, '/api/workflow/publish/report', {
			executionId: execution.id,
			purl,
			outcome: 'published',
		}));
		expect(recorded).toMatchObject({ kind: 'settled', entry: { purl, state: 'published' } });
	});
	expect((await executionOf(repository, execution.id)).publications.map(p => p.outcome)).toEqual(['succeeded']);
}, 60_000);

test('npm and PyPI packages publish through npm and uv and verify their integrity and sha256', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { repository, begun } = await released({ main: [npmId, pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	const state: Bindings = { commands: [] };
	const { result } = await publishing(identity, execution.id, {
		run: bindings(state, '1.1.0'),
		credentials: bindingCredentials,
		provenance: true,
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:npm/%40octo/lint@1.1.0', 'published'],
		['pkg:pypi/lint-py@1.1.0', 'published'],
	]);
	const npmAuth = { 'npm_config_//registry.npmjs.org/:_authToken': 'npm-secret' };
	const secrets = { NODE_AUTH_TOKEN: 'npm-secret', UV_PUBLISH_TOKEN: 'pypi-secret', ...npmAuth };
	expect(state.commands).toEqual([
		{ command: 'npm pack --json --pack-destination', cwd: 'bindings/js', env: {} },
		{ command: 'tar -xzOf package/package.json', cwd: '.', env: {} },
		{ command: 'npm publish --access public --tag latest --provenance', cwd: 'bindings/js', env: secrets },
		{ command: 'uv build --project bindings/python --out-dir', cwd: '.', env: {} },
		{ command: 'tar -xzOf lint_py-1.1.0/PKG-INFO', cwd: '.', env: {} },
		{ command: 'unzip -Z1', cwd: '.', env: {} },
		{ command: 'tar -tzf', cwd: '.', env: {} },
		{ command: 'uv publish --check-url https://pypi.org/simple/', cwd: '.', env: secrets },
	]);
	expect((await executionOf(repository, execution.id)).publications.map(p => [p.id, p.outcome, p.digest])).toEqual([
		[npmId, 'succeeded', npmIntegrity(npm, '1.1.0')],
		[pypiId, 'succeeded', createHash('sha256').update(sdist('1.1.0')).digest('hex')],
	]);
	expect(Effect.runSync(Effect.result(requireAll(result.success)))._tag).toBe('Success');
}, 60_000);

test('npm and PyPI versions the registries already have are reused or refused by digest', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [npmId, pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	world.npm.publish(npm, '1.1.0');
	pypi.set('lint-py@1.1.0', 'e'.repeat(64));
	const state: Bindings = { commands: [] };
	const { result } = await publishing(identity, execution.id, {
		run: bindings(state, '1.1.0'),
		credentials: bindingCredentials,
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:npm/%40octo/lint@1.1.0', 'reused'],
		['pkg:pypi/lint-py@1.1.0', 'failed-permanent', 'PyPI has a different lint-py 1.1.0'],
	]);
	expect(state.commands.map(entry => entry.command)).toEqual([
		'npm pack --json --pack-destination',
		'tar -xzOf package/package.json',
		'uv build --project bindings/python --out-dir',
		'tar -xzOf lint_py-1.1.0/PKG-INFO',
		'unzip -Z1',
		'tar -tzf',
	]);
	const required = Effect.runSync(Effect.result(requireAll(result.success)));
	expect(required._tag === 'Failure' && required.failure.message).toBe(
		'1 required publication did not publish: pkg:pypi/lint-py@1.1.0',
	);
}, 60_000);

test('an npm prerelease publishes under the stream prerelease channel without provenance', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [npmId] }, bindingsLayout, '1.1.0-rc.1');
	const { execution, identity } = started(begun, 'main');
	const state: Bindings = { commands: [] };
	const { result } = await publishing(identity, execution.id, {
		run: bindings(state, '1.1.0-rc.1'),
		credentials: { NPM_TOKEN: 'npm-token' },
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([['pkg:npm/%40octo/lint@1.1.0-rc.1', 'published']]);
	expect(state.commands.find(entry => entry.command.startsWith('npm publish'))).toEqual({
		command: 'npm publish --access public --tag next',
		cwd: 'bindings/js',
		env: { NPM_TOKEN: 'npm-secret', 'npm_config_//registry.npmjs.org/:_authToken': 'npm-secret' },
	});
	expect(world.npm.packages.get(npm)?.tags).toEqual({ latest: '1.0.0', next: '1.1.0-rc.1' });
}, 60_000);

test('npm provenance follows the visibility of the repository in the workflow event', () => {
	const event = (value: unknown) => {
		const path = join(target, `event-${crypto.randomUUID()}.json`);
		writeFileSync(path, JSON.stringify(value));
		return path;
	};
	expect(publicRepository(event({ repository: { private: false } }))).toBe(true);
	expect(publicRepository(event({ repository: { private: true } }))).toBe(false);
	expect(publicRepository(event({}))).toBe(false);
	expect(publicRepository(undefined)).toBe(false);
});

test('a crate that fails to package is reported failed and its dependent does not publish', async () => {
	const { begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {}, broken: ['lint-core'] };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		[
			'pkg:cargo/lint-core@1.1.0',
			'failed-retryable',
			'cargo package exited 101\nerror: failed to verify package lint-core',
		],
		['pkg:cargo/lint@1.1.0', 'failed-retryable', 'pkg:cargo/lint-core did not publish'],
	]);
}, 60_000);

test('a crate packaged without a README fails before its claim and its dependent does not publish', async () => {
	const { repository, begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {}, stripped: { 'lint-core': ['README.md'] } };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'failed-retryable', 'The lint-core 1.1.0 package lacks README'],
		['pkg:cargo/lint@1.1.0', 'failed-retryable', 'pkg:cargo/lint-core did not publish'],
	]);
	expect(state.commands.map(entry => entry.command)).toEqual([
		'metadata lint-core',
		'package --list lint-core',
		'package lint-core',
	]);
	expect((await ledgerOf(repository, execution.id)).records[0]?.attempts.map(attempt => attempt.event)).toEqual([
		'failed',
	]);
}, 60_000);

test('cargo metadata without description, license or repository fails the crate and names each field', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {} };
	const run = cargo(state);
	const { result } = await publishing(identity, execution.id, {
		run: (argv, options) =>
			argv[1] === 'metadata' ? Effect.succeed(cargoMetadata(target, { description: null })) : run(argv, options),
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		[
			'pkg:cargo/lint-core@1.1.0',
			'failed-retryable',
			'The lint-core 1.1.0 package lacks description, license, repository',
		],
	]);
}, 60_000);

test('npm and PyPI packages built without a README fail before their claims', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [npmId, pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	const state: Bindings = { commands: [], stripped: ['README.md'] };
	const { result } = await publishing(identity, execution.id, {
		run: bindings(state, '1.1.0'),
		credentials: bindingCredentials,
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:npm/%40octo/lint@1.1.0', 'failed-retryable', 'The @octo/lint 1.1.0 package lacks README'],
		['pkg:pypi/lint-py@1.1.0', 'failed-retryable', 'The lint-py 1.1.0 package lacks README'],
	]);
	expect(
		state.commands.some(entry => entry.command.startsWith('npm publish') || entry.command.startsWith('uv publish')),
	)
		.toBe(false);
}, 60_000);

test('Python core metadata needs a long description, a license, a license file and a project URL', () => {
	expect(pythonMissing(pkgInfo('1.1.0', true), true)).toEqual([]);
	expect(pythonMissing(pkgInfo('1.1.0', true), false)).toEqual(['a license file']);
	expect(pythonMissing('Metadata-Version: 2.1\nName: lint-py\nVersion: 1.1.0\nDescription: Lint bindings\n', true))
		.toEqual(['license', 'urls']);
	expect(
		pythonMissing(
			'Metadata-Version: 2.1\r\nName: lint-py\r\nLicense: MIT\r\nHome-page: https://example.com\r\n\r\nLong text\r\n',
			true,
		),
	).toEqual([]);
	expect(
		pythonMissing('Metadata-Version: 2.4\nName: lint-py\nLicense-File: LICENSE\nProject-URL: Docs, https://x\n', true),
	).toEqual(['README']);
});

test('a Python distribution ships a license file at the sdist root, in LICENSES/ or in the wheel dist-info', () => {
	expect(distributionLicensed('lint_py-1.1.0.tar.gz', ['lint_py-1.1.0/PKG-INFO', 'lint_py-1.1.0/LICENSE.txt'])).toBe(
		true,
	);
	expect(distributionLicensed('lint_py-1.1.0.tar.gz', ['lint_py-1.1.0/LICENSES/MIT.txt'])).toBe(true);
	expect(distributionLicensed('lint_py-1.1.0.tar.gz', ['lint_py-1.1.0/src/lint_py/LICENSE'])).toBe(false);
	expect(distributionLicensed('lint_py-1.1.0-py3-none-any.whl', ['lint_py-1.1.0.dist-info/licenses/LICENSE'])).toBe(
		true,
	);
	expect(distributionLicensed('lint_py-1.1.0-py3-none-any.whl', ['lint_py-1.1.0.dist-info/COPYING'])).toBe(true);
	expect(
		distributionLicensed('lint_py-1.1.0-py3-none-any.whl', ['lint_py/LICENSE', 'lint_py-1.1.0.dist-info/METADATA']),
	)
		.toBe(false);
});

test('a crate with only the license field and no license file fails before its claim', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {}, stripped: { 'lint-core': ['LICENSE'] } };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'failed-retryable', 'The lint-core 1.1.0 package lacks a license file'],
	]);
	expect(state.commands.some(entry => entry.command.startsWith('publish'))).toBe(false);
}, 60_000);

test('a crate whose license-file path is in the package passes without a LICENSE file', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: {} };
	const run = cargo(state);
	const listing = 'Cargo.toml\nREADME.md\nlegal/TERMS.txt\nsrc/lib.rs\n';
	const { result } = await publishing(identity, execution.id, {
		run: (argv, options) =>
			argv[1] === 'metadata'
				? Effect.succeed(cargoMetadata(target, { ...crateFields, license: null, license_file: 'legal/TERMS.txt' }))
				: argv[2] === '--list'
				? Effect.succeed({ code: 0, stdout: listing, output: listing })
				: run(argv, options),
		credentials: { CARGO_REGISTRY_TOKEN: 'crates-io' },
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([['pkg:cargo/lint-core@1.1.0', 'published']]);
}, 60_000);

test('npm and PyPI packages built without a license file fail before their claims', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [npmId, pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	const state: Bindings = { commands: [], stripped: ['LICENSE'] };
	const { result } = await publishing(identity, execution.id, {
		run: bindings(state, '1.1.0'),
		credentials: bindingCredentials,
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:npm/%40octo/lint@1.1.0', 'failed-retryable', 'The @octo/lint 1.1.0 package lacks a license file'],
		['pkg:pypi/lint-py@1.1.0', 'failed-retryable', 'The lint-py 1.1.0 package lacks a license file'],
	]);
}, 60_000);

test('a publish crates.io never lists fails after the verification polls run out', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: { 'lint-core': ['unlisted'] } };
	const { result, logs } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:cargo/lint-core@1.1.0', 'failed-retryable', 'The registry did not list lint-core 1.1.0 in time'],
	]);
	expect(logs.filter(line => line.startsWith('crates.io has not confirmed lint-core 1.1.0 yet'))).toHaveLength(19);
}, 60_000);

test('a Retry-After beyond this run ends it with the publication rate limited for the next dispatch', async () => {
	const { repository, begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const state: Cargo = { commands: [], outcomes: { 'lint-core': ['tomorrow'] } };
	const { result } = await publishing(identity, execution.id, state);
	expect(result._tag === 'Failure' && result.failure.message).toBe(
		'crates.io rate limits lint-core 1.1.0 until 2026-11-10T10:00:00.000Z; the next attempt is due after this run',
	);
	expect((await executionOf(repository, execution.id)).publications.map(p => [p.id, p.outcome])).toEqual([
		[core, 'rate-limited'],
	]);
	const run = repository.runs.find(entry => entry.id === identity.runId);
	if (!run) throw new Error('Missing run');
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(2_000);
	const waiting = await executionOf(repository, execution.id);
	expect([waiting.state, waiting.notBefore, waiting.reason]).toEqual([
		'ready',
		Date.parse('2026-11-10T10:00:00.000Z'),
		'Registry rate limit until 2026-11-10T10:00:00.000Z',
	]);
}, 60_000);

test(
	'a publish after a long slot wait still waits for crates.io to list it and stays inside the job timeout',
	async () => {
		const { repository, begun } = await released({ main: [core] });
		const { execution, identity } = started(begun, 'main');
		await world.budgets.instance('crates-io').storage.put('arrival:update', Date.now() + 29 * 60_000);
		const state: Cargo = { commands: [], outcomes: {} };
		const start = Date.now();
		registryLag = 4;
		const { result, logs } = await publishing(identity, execution.id, state);
		if (result._tag === 'Failure') throw new Error(result.failure.message);
		expect(states(result.success)).toEqual([['pkg:cargo/lint-core@1.1.0', 'published']]);
		expect(logs.filter(line => line.startsWith('crates.io has not confirmed lint-core 1.1.0 yet')).length)
			.toBeGreaterThan(0);
		expect(Date.now() - start).toBeLessThan(publishMinutes(1) * 60_000);
		expect((await ledgerOf(repository, execution.id)).records[0]?.status.state).toBe('published');
	},
	60_000,
);

test('waits across packages share one budget, so a run ends before the publish job timeout', async () => {
	const { begun } = await released({ main: [core, cli] });
	const { execution, identity } = started(begun, 'main');
	const budget = world.budgets.instance('crates-io').storage;
	await budget.put('arrival:update', Date.now() + 20 * 60_000);
	const state: Cargo = {
		commands: [],
		outcomes: { 'lint-core': ['ok'], lint: ['429'] },
	};
	const start = Date.now();
	const { result } = await publishing(identity, execution.id, state);
	expect(result._tag).toBe('Failure');
	expect(Date.now() - start).toBeLessThan(publishMinutes(2) * 60_000);
	expect(Date.now() - start).toBeLessThanOrEqual(publishWaitMinutes * 60_000 + 60_000);
}, 60_000);

test('a crates.io slot hours away ends the run before publishing', async () => {
	const { repository, begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	await world.budgets.instance('crates-io').storage.put('arrival:update', Date.now() + 3 * 3_600_000);
	const state: Cargo = { commands: [], outcomes: {} };
	const { result } = await publishing(identity, execution.id, state);
	expect(result._tag === 'Failure' && result.failure.message).toBe(
		'crates.io allows lint-core 1.1.0 at 2026-11-04T11:32:00.000Z; the next attempt is due after this run',
	);
	expect(state.commands.map(entry => entry.command)).toEqual([
		'metadata lint-core',
		'package --list lint-core',
		'package lint-core',
	]);
	expect((await ledgerOf(repository, execution.id)).records[0]?.status).toEqual({ state: 'planned' });
	const run = repository.runs.find(entry => entry.id === identity.runId);
	if (!run) throw new Error('Missing run');
	run.status = 'completed';
	run.conclusion = 'failure';
	await world.workflowRun(repository, run, 'failure', 'workflow_dispatch');
	await world.wait(2_000);
	const waiting = await executionOf(repository, execution.id);
	expect([waiting.state, waiting.notBefore]).toEqual(['ready', Date.parse('2026-11-04T11:32:00.000Z')]);
}, 60_000);

test('a run resumes a crate it already claimed, and reports need a claim', async () => {
	const { begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const [unclaimed, claimed] = await withIdentity(world, identity, async () => {
		const purl = 'pkg:cargo/lint-core@1.1.0';
		const report = { executionId: execution.id, purl, outcome: 'published' };
		const first = await Effect.runPromise(Effect.result(workflowCall(world, '/api/workflow/publish/report', report)));
		const claim = { executionId: execution.id, purl, digest: checksum('lint-core', '1.1.0') };
		return [first, await Effect.runPromise(workflowCall(world, '/api/workflow/publish/claim', claim))] as const;
	});
	expect(unclaimed._tag === 'Failure' && unclaimed.failure.message).toContain('This run does not hold lint-core 1.1.0');
	expect(claimed).toMatchObject({ kind: 'publish', package: { purl: 'pkg:cargo/lint-core@1.1.0' } });

	const state: Cargo = { commands: [], outcomes: {} };
	const { result } = await publishing(identity, execution.id, state);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([['pkg:cargo/lint-core@1.1.0', 'published']]);
	expect(state.commands.map(entry => entry.command)).toEqual([
		'metadata lint-core',
		'package --list lint-core',
		'package lint-core',
		'publish lint-core',
	]);
}, 60_000);

test('uv rate limits honour the Retry-After header', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	const limited: Bindings = { commands: [], limited: 1 };
	const first = await publishing(identity, execution.id, { run: bindings(limited, '1.1.0') });
	if (first.result._tag === 'Failure') throw new Error(first.result.failure.message);
	expect(states(first.result.success)).toEqual([['pkg:pypi/lint-py@1.1.0', 'published']]);
	expect(first.logs).toContain('PyPI rate limits lint-py 1.1.0 until 2026-11-04T09:01:45.000Z; waiting 45s');
	expect(limited.commands.filter(entry => entry.command.startsWith('uv publish')).map(entry => entry.env)).toEqual([
		{},
		{},
	]);
}, 60_000);

test('a uv build that writes no distribution fails the package', async () => {
	servePypi();
	world.npm.publish(npm, '1.0.0');
	const { begun } = await released({ main: [pypiId] }, bindingsLayout);
	const { execution, identity } = started(begun, 'main');
	const { result } = await publishing(identity, execution.id, {
		run: bindings({ commands: [], empty: true }, '1.1.0'),
	});
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(states(result.success)).toEqual([
		['pkg:pypi/lint-py@1.1.0', 'failed-retryable', 'uv build produced no distribution for lint-py'],
	]);
}, 60_000);

test('the publish runtime spawns the native tools and fails when a required publication does not publish', async () => {
	const { repository, begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const bin = join(target, 'bin');
	mkdirSync(bin);
	fakeCargo(bin, '', ' ');
	const result = await silenced(() =>
		withIdentity(world, identity, () => Effect.runPromise(Effect.result(main)), {
			PATH: `${bin}:${process.env.PATH}`,
			TARGET: target,
			RUNNER_TEMP: target,
			EXECUTION_ID: execution.id,
			SERVICE_ORIGIN: world.env.APPLICATION_ORIGIN,
		})
	);
	expect(result._tag === 'Failure' && result.failure.message).toBe(
		'1 required publication did not publish: pkg:cargo/lint-core@1.1.0',
	);
	const [record] = (await ledgerOf(repository, execution.id)).records;
	expect([record?.digest, record?.status]).toEqual([
		checksum('lint-core', '1.1.0'),
		{ state: 'failed-retryable', holder: `${identity.runId}:1`, error: 'error: crates.io rejected lint-core' },
	]);
}, 60_000);

test('the publish runtime installs the pinned toolchain and reads cargo metadata from stdout alone', async () => {
	const { repository, begun } = await released({ main: [core] });
	const { execution, identity } = started(begun, 'main');
	const bin = join(target, 'bin'), checkout = join(target, 'checkout'), calls = join(target, 'calls');
	mkdirSync(bin);
	mkdirSync(checkout);
	writeFileSync(join(checkout, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.99.1"\n');
	writeFileSync(
		join(bin, 'rustup'),
		`#!/usr/bin/env bash
echo "rustup $*" >> "$CALLS"
echo "info: syncing channel updates for '1.99.1-x86_64-unknown-linux-gnu'"
echo "info: downloading 8 components" >&2
`,
	);
	chmodSync(join(bin, 'rustup'), 0o755);
	fakeCargo(
		bin,
		'echo "cargo $1 $2" >> "$CALLS"\n',
		`
    echo "info: syncing channel updates for '1.99.1-x86_64-unknown-linux-gnu'" >&2
    echo "warn: the missing active toolchain '1.99.1' has been auto-installed" >&2
    `,
	);
	const cwd = process.cwd();
	process.chdir(checkout);
	const result = await silenced(() =>
		withIdentity(world, identity, () => Effect.runPromise(Effect.result(main)), {
			PATH: `${bin}:${process.env.PATH}`,
			TARGET: target,
			CALLS: calls,
			RUNNER_TEMP: target,
			EXECUTION_ID: execution.id,
			SERVICE_ORIGIN: world.env.APPLICATION_ORIGIN,
		})
	).finally(() => process.chdir(cwd));
	expect(result._tag === 'Failure' && result.failure.message).toBe(
		'1 required publication did not publish: pkg:cargo/lint-core@1.1.0',
	);
	expect(readFileSync(calls, 'utf8')).toBe(
		'rustup toolchain install\ncargo metadata --format-version\ncargo package --list\ncargo package --manifest-path\ncargo publish --manifest-path\n',
	);
	const [record] = (await ledgerOf(repository, execution.id)).records;
	expect([record?.digest, record?.status]).toEqual([
		checksum('lint-core', '1.1.0'),
		{ state: 'failed-retryable', holder: `${identity.runId}:1`, error: 'error: crates.io rejected lint-core' },
	]);
}, 60_000);
