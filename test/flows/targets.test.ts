import { expect, test } from 'bun:test';
import { Validator } from '@cfworker/json-schema';
import { Effect } from 'effect';
import { npmManager } from '@/automation/managers/npm';
import { discoverNpmTargets } from '@/automation/managers/npm-targets';
import { emptyInventory } from '@/automation/managers/registry';
import { assetName, binaryJobs } from '@/automation/setup-binaries';
import type { Snapshot } from '@/automation/types';
import { binaries, defaultBinaryTargets } from '@/contract/setup';
import { targetsSchema } from '@/contract/targets';
import { assertTargetsCurrent } from '@/tooling/schema/render';

const fixture = (name: string) => Bun.file(new URL(`../fixtures/targets/${name}.json`, import.meta.url));
const snapshot = (files: Record<string, string>, tags: string[] = []): Snapshot => ({
	repository: { id: 1, name: 'example/tool', defaultBranch: 'main' },
	sha: 'a'.repeat(40),
	files,
	paths: Object.keys(files),
	tags,
});

test('the published contract validates all five real repository descriptor shapes', async () => {
	const schema = await Bun.file(new URL('../../schemas/targets.v1.json', import.meta.url)).json();
	const validator = new Validator(schema, '2020-12', false);
	for (const name of ['runner', 'actionlint', 'kprint', 'overseer', 'kprint-build']) {
		const source = await fixture(name).json();
		expect({ name, valid: targetsSchema.safeParse(source).success }).toEqual({ name, valid: true });
		expect({ name, errors: validator.validate(source).errors }).toEqual({ name, errors: [] });
	}
	await Effect.runPromise(assertTargetsCurrent);
});

test('known fields reject malformed types while platform and build extensions stay open', async () => {
	const source = await fixture('runner').json();
	for (
		const broken of [
			{ ...source, scope: 'invalid' },
			{ ...source, versionSource: '../Cargo.toml#package.version' },
			{ ...source, targets: [] },
			{ ...source, targets: [{ pkg: 'freebsd-x64', os: [], cpu: 'x64' }] },
			{ ...source, targets: [{ pkg: 'freebsd-x64', os: 'freebsd', cpu: 64 }] },
		]
	) expect(targetsSchema.safeParse(broken).success).toBe(false);
	expect(
		targetsSchema.safeParse({
			...source,
			targets: [{ pkg: 'haiku-riscv64', os: 'haiku', cpu: 'riscv64', build: 'custom', extension: { enabled: true } }],
		}).success,
	).toBe(true);
});

test('real npm descriptors discover every package with the correct shared version source', async () => {
	for (
		const [name, count, versionSource, files] of [
			['runner', 15, 'Cargo.toml#workspace.package.version', { 'Cargo.toml': '[workspace.package]\nversion="0.28.0"' }],
			['kprint', 18, 'crates/kprint/Cargo.toml#package.version', {
				'crates/kprint/Cargo.toml': '[package]\nversion="0.60.7"',
			}],
			['actionlint', 12, 'tags:', { 'go.mod': 'module example/tool\n' }],
		] as const
	) {
		const result = npmManager.discover(
			snapshot({ ...files, 'distribution/npm/targets.json': await fixture(name).text() }, ['v1.7.12']),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.packages).toHaveLength(count);
		expect(result.packages.every(pkg => pkg.versionSource === versionSource && pkg.generated && pkg.version)).toBe(
			true,
		);
		if (name === 'actionlint') {
			expect(result.packages.find(pkg => pkg.name === '@kjanat-actionlint/actionlint-freebsd-x64')?.version).toBe(
				'1.7.12',
			);
		}
	}
});

test('platform maps use declared dependencies and never invent npm names', async () => {
	const platforms = await fixture('overseer').json();
	const source = JSON.stringify({ $schema: 'https://beepboop.kjanat.dev/schema/targets.v1.json', ...platforms });
	const dependencies = Object.fromEntries(Object.keys(platforms).map(key => [`@example/tool-${key}`, '2.3.4']));
	const files = {
		'npm/scripts/platforms.json': source,
		'npm/tool/package.json': JSON.stringify({
			name: '@example/tool',
			version: '2.3.4',
			optionalDependencies: dependencies,
		}),
	};
	const result = npmManager.discover(snapshot(files));
	expect(result.diagnostics).toEqual([]);
	expect(result.packages.map(pkg => pkg.name).sort()).toEqual(['@example/tool', ...Object.keys(dependencies)].sort());
	expect(result.packages.every(pkg => pkg.versionSource === 'npm/tool/package.json#version')).toBe(true);
	const inventory = emptyInventory();
	expect(discoverNpmTargets(snapshot({ 'platforms.json': source }), inventory)).toBe(false);
	expect(inventory.packages).toEqual([]);
});

test('duplicate targets fail discovery instead of double counting a publication', async () => {
	const source = await fixture('runner').json();
	source.targets.push(source.targets[0]);
	const result = npmManager.discover(
		snapshot({ 'npm/targets.json': JSON.stringify(source), 'Cargo.toml': '[workspace.package]\nversion="1.0.0"' }),
	);
	expect(result.packages).toEqual([]);
	expect(result.diagnostics[0]?.message).toContain('duplicate');
});

const go = {
	toolchain: 'go',
	name: 'tool',
	module: '.',
	package: '.',
	asset: '{name}-{go.os}-{go.arch}{ext}',
} as const;
const cargo = { toolchain: 'cargo', name: 'tool', manifest: 'Cargo.toml', asset: '{name}-{rust.target}{ext}' } as const;

test('new Go platforms generate executable cross-build jobs and retain existing defaults', () => {
	expect(binaries.parse({ builds: [go] }).targets).toEqual([...defaultBinaryTargets]);
	const release = binaries.parse({
		builds: [go],
		targets: [
			'freebsd-amd64',
			'netbsd-arm64',
			'openbsd-amd64',
			'dragonfly-amd64',
			'solaris-amd64',
			'illumos-amd64',
			'aix-ppc64',
		],
	});
	const jobs = binaryJobs(release, {}, 'release');
	expect(jobs['build-tool']).toMatchObject({
		'runs-on': 'ubuntu-26.04',
		strategy: {
			matrix: {
				include: release.targets.map(target => ({
					goos: target.split('-')[0],
					goarch: target.split('-')[1],
					asset: `tool-${target}`,
				})),
			},
		},
	});
	expect(assetName(go, 'windows-amd64')).toBe('tool-windows-amd64.exe');
});

test('Rust Android and BSD targets install cross and preserve native auditable builds', () => {
	const release = binaries.parse({
		builds: [cargo],
		targets: ['linux-amd64', 'android-arm64', 'freebsd-amd64', 'netbsd-amd64'],
	});
	const job = binaryJobs(release, {}, 'release')['build-tool'];
	expect(job).toMatchObject({
		strategy: {
			matrix: {
				include: [
					{ builder: 'cargo', target: 'x86_64-unknown-linux-gnu' },
					{ builder: 'cross', target: 'aarch64-linux-android' },
					{ builder: 'cross', target: 'x86_64-unknown-freebsd' },
					{ builder: 'cross', target: 'x86_64-unknown-netbsd' },
				],
			},
		},
	});
	expect(JSON.stringify(job)).toContain('"tool":"cross"');
	expect(JSON.stringify(job)).not.toContain('cross@');
	expect(JSON.stringify(job)).toContain('CROSS_TARGET_AARCH64_LINUX_ANDROID_IMAGE');
	expect(JSON.stringify(job)).toContain('CROSS_TARGET_X86_64_UNKNOWN_NETBSD_IMAGE');
	expect(JSON.stringify(job)).toContain('ghcr.io/cross-rs/aarch64-linux-android:main');
	expect(JSON.stringify(job)).toContain('cargo auditable build');
	expect(JSON.stringify(job)).toContain('cross build');
	for (const release of [{ builds: [go], targets: ['android-arm64'] }, { builds: [cargo], targets: ['aix-ppc64'] }]) {
		expect(binaries.safeParse(release).success).toBe(false);
	}
});
