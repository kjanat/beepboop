import { expect, test } from 'bun:test';
import { binaryCandidates, unixDependencies } from '@/automation/binary-candidates';
import { discover } from '@/automation/managers';
import type { Snapshot } from '@/automation/types';
import { supportedTargets } from '@/contract/binary-platforms';
import { leftOut } from '@/contract/setup';

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
