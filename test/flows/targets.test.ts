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

test('experimental platform-map entries remain optional publications', () => {
	const result = npmManager.discover(snapshot({
		'npm/platforms.json': JSON.stringify({
			'linux-x64': { os: 'linux', cpu: 'x64' },
			'freebsd-x64': { os: 'freebsd', cpu: 'x64', experimental: true },
		}),
		'npm/tool/package.json': JSON.stringify({
			name: '@example/tool',
			version: '1.2.3',
			optionalDependencies: { '@example/tool-linux-x64': '1.2.3', '@example/tool-freebsd-x64': '1.2.3' },
		}),
	}));
	expect(result.diagnostics).toEqual([]);
	expect(result.packages.map(pkg => [pkg.name, pkg.optional])).toEqual([
		['@example/tool-linux-x64', false],
		['@example/tool-freebsd-x64', true],
		['@example/tool', false],
	]);
	expect(result.packages.find(pkg => pkg.name === '@example/tool')?.dependencies).toContain(
		'@example/tool-freebsd-x64',
	);
});

test('platform maps preserve private and foreign-registry facade exclusions', () => {
	for (
		const [fields, reason] of [
			[{ publishConfig: { registry: 'https://npm.example.com' } }, 'other-registry'],
			[{ private: true }, 'private'],
		] as const
	) {
		const result = npmManager.discover(snapshot({
			'npm/platforms.json': JSON.stringify({ 'linux-x64': { os: 'linux', cpu: 'x64' } }),
			'npm/tool/package.json': JSON.stringify({
				name: '@example/tool',
				version: '1.2.3',
				optionalDependencies: { '@example/tool-linux-x64': '1.2.3' },
				...fields,
			}),
		}));
		expect(result.diagnostics).toEqual([]);
		expect(result.packages).toHaveLength(1);
		expect(result.packages[0]).toMatchObject({
			name: '@example/tool',
			manifest: 'npm/tool/package.json',
			publication: { kind: 'excluded', reason },
		});
		expect(result.packages[0]?.generated).toBeUndefined();
	}
});

test('npm name segments reject uppercase while build metadata stays open', async () => {
	const validator = new Validator(
		await Bun.file(new URL('../../schemas/targets.v1.json', import.meta.url)).json(),
		'2020-12',
		false,
	);
	const valid = {
		scope: '@example',
		facade: 'tool',
		targets: [{ pkg: 'linux-x64', rust: 'CustomTarget', build: 'CustomBuild' }],
	};
	for (
		const source of [
			{ ...valid, targets: [{ pkg: 'Linux-x64' }] },
			{ scope: '@example', facades: [{ name: 'tool', pkg: 'Tool' }], targets: valid.targets },
			{ platformScope: '@example', binary: 'Tool', facade: 'tool', targets: valid.targets },
		]
	) {
		expect(targetsSchema.safeParse(source).success).toBe(false);
		expect(validator.validate(source).valid).toBe(false);
	}
	expect(targetsSchema.safeParse(valid).success).toBe(true);
	expect(validator.validate(valid).valid).toBe(true);
});

const linuxMap = JSON.stringify({ 'linux-x64': { os: 'linux', cpu: 'x64' } });
const facadeManifest = (name: string, version: string) => JSON.stringify({
	name,
	version,
	optionalDependencies: { [`${name}-linux-x64`]: version },
});

test('partial and ambiguous map matches report diagnostics without changing publications', () => {
	for (const extra of [{}, { '@other/tool-linux-x64': '1.2.3' }]) {
		const manifest = JSON.stringify({
			name: '@example/tool',
			version: '1.2.3',
			optionalDependencies: { '@example/tool-linux-x64': '1.2.3', ...extra },
		});
		const files = { 'npm/tool/package.json': manifest };
		const original = npmManager.discover(snapshot(files));
		const result = npmManager.discover(snapshot({
			...files,
			'npm/platforms.json': JSON.stringify({
				'linux-x64': { os: 'linux', cpu: 'x64' },
				'darwin-arm64': { os: 'darwin', cpu: 'arm64' },
			}),
		}));
		expect(result.packages).toEqual(original.packages);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.message).toContain('darwin-arm64 (0 matches)');
		if (Object.keys(extra).length) expect(result.diagnostics[0]?.message).toContain('linux-x64 (2 matches)');
	}
});

test('explicit descriptors skip excluded facades and their generated groups', () => {
	for (const fields of [{ private: true }, { publishConfig: { registry: 'https://npm.example.com' } }]) {
		const files = { 'npm/tool/package.json': JSON.stringify({ name: '@example/tool', version: '1.2.3', ...fields }) };
		const original = npmManager.discover(snapshot(files));
		const result = npmManager.discover(snapshot({
			...files,
			'npm/targets.json': JSON.stringify({
				scope: '@example',
				facades: [{ name: '@example/tool', pkg: 'tool', shim: 'tool' }],
				bundle: { name: '@example/all' },
				targets: [{ pkg: 'linux-x64' }],
			}),
		}));
		expect(result.diagnostics).toEqual([]);
		expect(result.packages).toEqual(original.packages);
	}
});

test('generated platform, shim and bundle names preserve checked-in exclusion policies', () => {
	for (const fields of [{ private: true }, { publishConfig: { registry: 'https://npm.example.com' } }]) {
		const files = Object.fromEntries(['@example/tool-linux-x64', 'tool', '@example/all'].map((name, index) => [
			`npm/excluded-${index}/package.json`,
			JSON.stringify({ name, version: '0.1.0', ...fields }),
		]));
		const originals = npmManager.discover(snapshot(files)).packages;
		const descriptors: Record<string, string>[] = [
			{
				'npm/targets.json': JSON.stringify({
					scope: '@example',
					facades: [{ name: '@example/tool', pkg: 'tool', shim: 'tool' }],
					bundle: { name: '@example/all' },
					targets: [{ pkg: 'linux-x64' }],
				}),
			},
			{ 'npm/platforms.json': linuxMap },
		];
		for (const descriptor of descriptors) {
			const result = npmManager.discover(
				snapshot({ ...files, ...descriptor, 'npm/tool/package.json': facadeManifest('@example/tool', '1.2.3') }),
			);
			expect(result.diagnostics).toEqual([]);
			for (const original of originals) {
				expect(result.packages.find(pkg => pkg.name === original.name)).toEqual(original);
			}
			expect(result.packages.find(pkg => pkg.name === '@example/tool')).toMatchObject({
				generated: true,
				dependencies: ['@example/tool-linux-x64'],
			});
		}
	}
});

test('independent platform maps own their facades and versions regardless of file order', () => {
	const files = {
		'packages/a/scripts/platforms.json': linuxMap,
		'packages/b/scripts/platforms.json': linuxMap,
		'packages/a/package.json': facadeManifest('@example/a', '1.2.3'),
		'packages/b/package.json': facadeManifest('@example/b', '4.5.6'),
	};
	for (const entries of [Object.entries(files), Object.entries(files).reverse()]) {
		const result = npmManager.discover(snapshot(Object.fromEntries(entries)));
		expect(result.diagnostics).toEqual([]);
		expect(result.packages).toHaveLength(4);
		for (const [key, version] of [['a', '1.2.3'], ['b', '4.5.6']]) {
			for (const suffix of ['', '-linux-x64']) {
				expect(result.packages.find(pkg => pkg.name === `@example/${key}${suffix}`)).toMatchObject({
					version,
					manifest: `packages/${key}/scripts/platforms.json`,
					versionSource: `packages/${key}/package.json#version`,
				});
			}
		}
	}
});

test('shared maps support nested facades with independent versions and more specific owners', () => {
	const files = {
		'scripts/platforms.json': linuxMap,
		'packages/a/package.json': facadeManifest('@example/a', '1.2.3'),
		'packages/b/package.json': facadeManifest('@example/b', '4.5.6'),
		'Cargo.toml': '[package]\nversion="9.9.9"',
	};
	for (const nested of [false, true]) {
		const result = npmManager.discover(
			snapshot({ ...files, ...(nested ? { 'packages/b/platforms.json': linuxMap } : {}) }),
		);
		expect(result.diagnostics).toEqual([]);
		expect(result.packages).toHaveLength(4);
		for (const [key, version] of [['a', '1.2.3'], ['b', '4.5.6']]) {
			for (const suffix of ['', '-linux-x64']) {
				expect(result.packages.find(pkg => pkg.name === `@example/${key}${suffix}`)).toMatchObject({
					version,
					manifest: nested && key === 'b' ? 'packages/b/platforms.json' : 'scripts/platforms.json',
					versionSource: `packages/${key}/package.json#version`,
				});
			}
		}
	}
});

test('equally scoped maps report ambiguous ownership without replacing facades', () => {
	const files = { 'npm/tool/package.json': facadeManifest('@example/tool', '1.2.3') };
	const original = npmManager.discover(snapshot(files));
	const result = npmManager.discover(
		snapshot({ ...files, 'npm/platforms.json': linuxMap, 'npm/targets.json': linuxMap }),
	);
	expect(result.packages).toEqual(original.packages);
	expect(result.diagnostics).toHaveLength(2);
	expect(result.diagnostics.every(diagnostic => diagnostic.message.includes('ambiguous platform maps'))).toBe(true);
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
