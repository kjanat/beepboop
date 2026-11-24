import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { binaryCandidates, goMainSources, unixDependencies } from '@/discovery/analysis/binary-candidates.ts';
import { unsettableVersion } from '@/discovery/analysis/go-version.ts';
import { discover } from '@/discovery/discover.ts';
import { buildSnapshot } from '@/discovery/snapshot/builder.ts';
import type { BinaryBuild, BinaryCandidate, VersionDeclaration } from '@/domain/binary-platforms.ts';
import { candidateOf, leftOut, supportedTargets } from '@/domain/binary-platforms.ts';
import type { Snapshot } from '@/domain/inventory.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

function snapshot(files: Record<string, string>, extra: string[] = []): Snapshot {
	return {
		repository: { id: 1, name: 'octo/example', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: [...Object.keys(files), ...extra],
	};
}
function candidates(files: Record<string, string>, extra: string[] = []) {
	const source = snapshot(files, extra);
	return binaryCandidates(source, discover(source));
}

test('a crate with src/main.rs or a [[bin]] target proposes each binary for every platform', () => {
	expect(candidates({
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\n\n[[bin]]\nname = "helper"\npath = "src/helper.rs"\n',
	}, ['src/main.rs'])).toEqual([
		{
			package: 'pkg:cargo/tool',
			build: { toolchain: 'cargo', name: 'helper', manifest: 'Cargo.toml', asset: '{name}-{rust.target}{ext}' },
			targets: supportedTargets('cargo'),
		},
		{
			package: 'pkg:cargo/tool',
			build: { toolchain: 'cargo', name: 'tool', manifest: 'Cargo.toml', asset: '{name}-{rust.target}{ext}' },
			targets: supportedTargets('cargo'),
		},
	]);
	expect(candidates({ 'Cargo.toml': '[package]\nname = "library"\nversion = "1.0.0"\n' }, ['src/lib.rs'])).toEqual([]);
});

test('an unconditional Unix-only dependency leaves out the Windows targets and says why', () => {
	const [candidate] = candidates({
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\n\n[dependencies]\nnix = "0.30"\n',
	}, ['src/main.rs']);
	expect(candidate?.targets).toEqual(supportedTargets('cargo').filter(target => !target.startsWith('windows-')));
	expect(candidate?.reason).toBe('tool depends on nix, which build only for Unix');
	expect(candidate && leftOut(candidate)).toBe(
		'tool leaves out Windows: tool depends on nix, which build only for Unix.',
	);
});

test('rustix limits targets only with features beyond its Windows support, and target dependencies stay out', () => {
	const tool = (dependencies: string) =>
		snapshot({ 'Cargo.toml': `[package]\nname = "tool"\nversion = "1.0.0"\n\n${dependencies}` }, ['src/main.rs']);
	expect(unixDependencies(tool('[dependencies]\nrustix = { version = "1", features = ["net"] }\n'), 'Cargo.toml'))
		.toEqual([]);
	expect(
		unixDependencies(tool('[dependencies]\nrustix = { version = "1", features = ["process", "fs"] }\n'), 'Cargo.toml'),
	)
		.toEqual(['rustix (fs, process)']);
	expect(unixDependencies(tool('[target.\'cfg(unix)\'.dependencies]\nnix = "0.30"\n'), 'Cargo.toml')).toEqual([]);
});

test('Go main packages under cmd and at the module root are proposed, internal, testdata and nested modules are not', () => {
	const found = candidates({
		'go.mod': 'module github.com/octo/example\n\ngo 1.26\n',
		'tools/go.mod': 'module tools\n',
	}, [
		'main.go',
		'cmd/client/main.go',
		'internal/gen/main.go',
		'cmd/testdata/fixture/main.go',
		'tools/lint/main.go',
	]);
	expect(
		found.filter(candidate => candidate.package === 'pkg:golang/github.com/octo/example').map(candidate =>
			candidate.build
		),
	)
		.toEqual([
			{ toolchain: 'go', name: 'example', module: '.', package: '.', asset: '{name}-{go.os}-{go.arch}{ext}' },
			{ toolchain: 'go', name: 'client', module: '.', package: './cmd/client', asset: '{name}-{go.os}-{go.arch}{ext}' },
		]);
});

test('a package-level main.version that -X cannot set is reported with its type, others are not', () => {
	const cases: [string, VersionDeclaration | undefined][] = [
		['var version = "dev"', undefined],
		['var version string', undefined],
		['var version string = `dev`', undefined],
		['var version = string(build)', undefined],
		['var version = commit()', undefined],
		['var version = &cli.Command{\n\tName: "version",\n}', { kind: 'var', type: '*cli.Command' }],
		['var version cli.Command', undefined],
		['var version Unknown', undefined],
		['var version int', { kind: 'var', type: 'int' }],
		['var version *string', { kind: 'var', type: '*string' }],
		['var version any', { kind: 'var', type: 'any' }],
		['var version = []string{"a"}', { kind: 'var', type: '[]string' }],
		['var version = 3', { kind: 'var', type: 'int' }],
		['var version = 1.5', { kind: 'var', type: 'float64' }],
		["var version = 'v'", { kind: 'var', type: 'rune' }],
		['var version = true', { kind: 'var', type: 'bool' }],
		['var (\n\tcommit = "abc"\n\tversion = 2\n)', { kind: 'var', type: 'int' }],
		['var (\n\tcommit string\n\tversion string\n)', undefined],
		['var commit, version = "abc", 7', { kind: 'var', type: 'int' }],
		['var commit, version = pair()', undefined],
		['const version = "dev"', { kind: 'const' }],
		['const (\n\tname = "tool"\n\tversion = "dev"\n)', { kind: 'const' }],
		['var version =\n\t3', { kind: 'var', type: 'int' }],
		['func main() {\n\tprintln()\n\tvar version = 1\n\t_ = version\n}', undefined],
		['var name = "a;var version = true;" // ;var version = true', undefined],
		['/*;var version = true;*/\nvar raw = `;var version = true;`', undefined],
		['var name = 1 /*\n*/var version = true', { kind: 'var', type: 'bool' }],
		['type version struct{}', undefined],
		['var version = info{}.String()', undefined],
		['var version = []string{"1.0"}[0]', undefined],
		['var version = -1', { kind: 'var', type: 'int' }],
		['var version = -1.5', { kind: 'var', type: 'float64' }],
		['var x = 1.\nvar version = 2', { kind: 'var', type: 'int' }],
		['var version (string)', undefined],
		['type V = string\nvar version V', undefined],
		['type (\n\tV = string\n)\nvar version V', undefined],
		['type V string\nvar version V', { kind: 'var', type: 'V' }],
		['type A = string\ntype B = A\nvar version B', undefined],
		['type A = (string)\nvar version A', undefined],
		['type A = (int)\nvar version A', { kind: 'var', type: 'A' }],
		['type A = int\ntype B = A\nvar version B', { kind: 'var', type: 'B' }],
		['type A = B\ntype B = A\nvar version A', undefined],
	];
	for (const [source, expected] of cases) {
		expect([source, unsettableVersion([['main.go', `package main\n\n${source}\n`]])]).toEqual([
			source,
			expected && { ...expected, file: 'main.go' },
		]);
	}
});

test('Go files outside the main package build do not decide main.version, and aliases resolve across files', () => {
	const declared = 'package main\n\nvar version = 1\n';
	expect(unsettableVersion([['gen.go', `//go:build ignore\n\n${declared}`]])).toBeUndefined();
	expect(unsettableVersion([['gen.go', `// +build ignore\n\n${declared}`]])).toBeUndefined();
	expect(
		unsettableVersion([
			['a_tools.go', `//go:build tools\n\n${declared}`],
			['main.go', 'package main\n\nvar version string\n'],
		]),
	).toBeUndefined();
	expect(unsettableVersion([['version.go', `// +build linux\n\n${declared}`]])).toBeUndefined();
	expect(
		unsettableVersion([
			['main.go', 'package main\n\nvar version V\n'],
			['types.go', '//go:build windows\n\npackage main\n\ntype V struct{}\n'],
		]),
	).toBeUndefined();
	for (
		const source of [
			'package main\n\n// #include <stdio.h>\nimport "C"\n\nvar version = 1\n',
			'package main\n\nimport (\n\t"fmt"\n\t"C"\n)\n\nvar version = 1\n',
			'package main\n\nimport("C")\n\nvar version = 1\n',
		]
	) {
		expect([source, unsettableVersion([['cgo.go', source], ['main.go', 'package main\n']])]).toEqual([
			source,
			undefined,
		]);
	}
	expect(unsettableVersion([['main.go', 'package main\n\nimport "Cfg"\n\nvar version = 1\n']])).toEqual({
		kind: 'var',
		type: 'int',
		file: 'main.go',
	});
	for (const file of ['version_windows.go', 'v_linux_arm64.go', 'cmd/x/version_amd64.go']) {
		expect([file, unsettableVersion([[file, declared]])]).toEqual([file, undefined]);
	}
	for (const file of ['linux.go', 'version_tools.go', 'cmd/x_windows/version.go']) {
		expect([file, unsettableVersion([[file, declared]])]).toEqual([file, { kind: 'var', type: 'int', file }]);
	}
	expect(unsettableVersion([['doc.go', 'package other\n\nvar version = 1\n']])).toBeUndefined();
	expect(unsettableVersion([['main.go', declared]])).toEqual({ kind: 'var', type: 'int', file: 'main.go' });
	expect(
		unsettableVersion([
			['main.go', 'package main\n\nvar version V\n'],
			['types.go', 'package main\n\ntype V = string\n'],
		]),
	).toBeUndefined();
	expect(goMainSources(['go.mod', 'main.go', 'gen.go', '_old.go', '.#main.go', 'cmd/_x/main.go'])).toEqual([
		'main.go',
		'gen.go',
	]);
});

test('a Go binary names the file that declares an unsettable main.version', () => {
	const source: Snapshot = {
		...snapshot({ 'go.mod': 'module github.com/octo/example\n\ngo 1.26\n' }, [
			'cmd/tool/main.go',
			'cmd/tool/version.go',
			'cmd/other/main.go',
		]),
		goSources: {
			'cmd/tool/main.go': 'package main\n\nfunc main() {}\n',
			'cmd/tool/version.go': 'package main\n\nconst version = "dev"\n',
			'cmd/other/main.go': 'package main\n\nvar version = "dev"\n\nfunc main() {}\n',
		},
	};
	expect(
		binaryCandidates(source, discover(source)).map(candidate => [candidate.build.name, candidate.unsettableVersion]),
	)
		.toEqual([['tool', { kind: 'const', file: 'cmd/tool/version.go' }], ['other', undefined]]);
});

test('a configured build finds its candidate whether its paths start with ./ or not', () => {
	const goBuild: Extract<BinaryBuild, { toolchain: 'go' }> = {
		toolchain: 'go',
		name: 'signer',
		module: 'client',
		package: './cmd/signer',
		asset: '{name}',
	};
	const cargoBuild: Extract<BinaryBuild, { toolchain: 'cargo' }> = {
		toolchain: 'cargo',
		name: 'tool',
		manifest: 'a/Cargo.toml',
		asset: '{name}',
	};
	const go: BinaryCandidate = { package: 'pkg:golang/example/client', build: goBuild, targets: [] };
	const cargo: BinaryCandidate = { package: 'pkg:cargo/a', build: cargoBuild, targets: [] };
	expect([
		candidateOf([go, cargo], { ...goBuild, module: './client' }),
		candidateOf([go, cargo], { ...goBuild, module: './client/', package: './cmd/./signer' }),
		candidateOf([go, cargo], { ...cargoBuild, manifest: './a/Cargo.toml' }),
		candidateOf([go, cargo], { ...goBuild, module: 'client2' }),
		candidateOf([go, cargo], { ...cargoBuild, manifest: 'b/Cargo.toml' }),
	]).toEqual([go, go, cargo, undefined, undefined]);
});

test('the snapshot reads Go sources of main packages within the discovery file limit', async () => {
	const build = (paths: string[]) =>
		Effect.runPromise(buildSnapshot({
			repository: { id: 1, name: 'octo/example', defaultBranch: 'main' },
			sha: 'a'.repeat(40),
			entries: paths.map(path => ({ path, type: 'blob', mode: '100644' })),
			read: path =>
				path === 'bindata.go'
					? precondition('Unsupported file')
					: Effect.succeed(path.endsWith('go.mod') ? 'module example\n' : `// ${path}\n`),
			tags: () => Effect.succeed([]),
		}));
	const built = await build([
		'go.mod',
		'main.go',
		'version.go',
		'bindata.go',
		'main_test.go',
		'internal/gen/main.go',
		'pkg/lib.go',
		'fixtures/app/go.mod',
		'fixtures/app/main.go',
	]);
	expect(built.goSources).toEqual({ 'main.go': '// main.go\n', 'version.go': '// version.go\n' });
	const manifests = Array.from({ length: 399 }, (_, index) => `m${index}/go.mod`);
	const limited = await build([...manifests, 'm0/cmd/a/main.go', 'm0/cmd/b/main.go']);
	expect(Object.keys(limited.goSources ?? {})).toEqual(['m0/cmd/a/main.go']);
	expect(await build(['tool/go.mod', 'tool/lib.go', 'main.go'])).not.toHaveProperty('goSources');
});
