import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { HomebrewConfiguration } from '@/distribution/homebrew/generate';
import { generateCask, homebrewConfiguration } from '@/distribution/homebrew/generate';
import { writeRendered } from '@/distribution/output';
import type { ScoopConfiguration } from '@/distribution/scoop/generate';
import { generateManifest, scoopConfiguration } from '@/distribution/scoop/generate';
import { generateManifests } from '@/distribution/winget/generate';
import { withEnvironment } from '@root/test/support/process.ts';

const digest = (character: string) => character.repeat(64);
const checksums = [
	`${digest('a')}  kprint-aarch64-apple-darwin.zip`,
	`${digest('b')}  kprint-x86_64-apple-darwin.zip`,
	`${digest('c')}  kprint-aarch64-unknown-linux-gnu.zip`,
	`${digest('d')}  kprint-x86_64-unknown-linux-gnu.zip`,
	`${digest('E')} *kprint-x86_64-pc-windows-msvc.zip`,
	`${digest('f')}  kprint-aarch64-pc-windows-msvc.zip`,
].join('\n');

const kprintCask: HomebrewConfiguration = {
	token: 'kprint',
	name: 'kprint',
	desc: 'Pluggable and configurable code formatter written in Rust, forked from dprint',
	homepage: 'https://dprint.kjanat.dev',
	url: 'https://github.com/kjanat/kprint/releases/download/{tag}/{asset}',
	verified: 'github.com/kjanat/kprint/',
	macos: { arm: 'kprint-aarch64-apple-darwin.zip', intel: 'kprint-x86_64-apple-darwin.zip' },
	linux: { arm: 'kprint-aarch64-unknown-linux-gnu.zip', intel: 'kprint-x86_64-unknown-linux-gnu.zip' },
	binaries: [{ path: 'kprint' }, { path: 'kprint', target: 'dprint' }],
	completions: { executable: 'kprint', arguments: ['completions'], shells: ['bash', 'zsh', 'fish'] },
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect));

test('a cask puts version, sha256 and url in each architecture and derives its stanzas from the config', async () => {
	const result = await run(generateCask({ configuration: kprintCask, version: '0.61.0', tag: '0.61.0', checksums }));
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(result.success).toBe(`# frozen_string_literal: true

cask "kprint" do
  on_macos do
    on_arm do
      version "0.61.0"
      sha256 "${digest('a')}"
      url "https://github.com/kjanat/kprint/releases/download/#{version}/kprint-aarch64-apple-darwin.zip",
          verified: "github.com/kjanat/kprint/"
    end
    on_intel do
      version "0.61.0"
      sha256 "${digest('b')}"
      url "https://github.com/kjanat/kprint/releases/download/#{version}/kprint-x86_64-apple-darwin.zip",
          verified: "github.com/kjanat/kprint/"
    end
  end
  on_linux do
    on_arm do
      version "0.61.0"
      sha256 "${digest('c')}"
      url "https://github.com/kjanat/kprint/releases/download/#{version}/kprint-aarch64-unknown-linux-gnu.zip",
          verified: "github.com/kjanat/kprint/"
    end
    on_intel do
      version "0.61.0"
      sha256 "${digest('d')}"
      url "https://github.com/kjanat/kprint/releases/download/#{version}/kprint-x86_64-unknown-linux-gnu.zip",
          verified: "github.com/kjanat/kprint/"
    end
  end

  name "kprint"
  desc "Pluggable and configurable code formatter written in Rust, forked from dprint"
  homepage "https://dprint.kjanat.dev"

  livecheck do
    url :url
    strategy :github_latest
  end

  binary "kprint"
  binary "kprint", target: "dprint"
  generate_completions_from_executable "kprint", "completions",
                                       base_name: "kprint",
                                       shells:    [:bash, :zsh, :fish]

  preflight_steps do
    mkdir_p "etc/bash_completion.d", base: :homebrew_prefix
    mkdir_p "share/zsh/site-functions", base: :homebrew_prefix
    mkdir_p "share/fish/vendor_completions.d", base: :homebrew_prefix
    on_macos do
      run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}"]
    end
  end

  zap :not_required
end
`);
});

test('a naked binary cask renames its download, and a prefixed tag gets a livecheck regex', async () => {
	const result = await run(generateCask({
		configuration: {
			token: 'fsql',
			name: 'fsql',
			desc: 'Query and modify the "filesystem" with #{SQL}',
			homepage: 'https://github.com/kjanat/fsql',
			url: 'https://github.com/kjanat/fsql/releases/download/{tag}/{asset}',
			linux: { arm: 'fsql-{version}-arm64', intel: 'fsql-{version}-amd64', caveats: 'Needs glibc 2.34.' },
			naked: { glob: 'fsql-*', name: 'fsql' },
			binaries: [{ path: 'fsql' }],
			caveats: 'Restart your shell.',
		},
		version: '1.2.3',
		tag: 'fsql-v1.2.3',
		checksums: `${digest('1')}  fsql-1.2.3-arm64\n${digest('2')}  fsql-1.2.3-amd64\n`,
	}));
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(result.success).toBe(`# frozen_string_literal: true

cask "fsql" do
  on_linux do
    on_arm do
      version "1.2.3"
      sha256 "${digest('1')}"
      url "https://github.com/kjanat/fsql/releases/download/fsql-v#{version}/fsql-#{version}-arm64"
    end
    on_intel do
      version "1.2.3"
      sha256 "${digest('2')}"
      url "https://github.com/kjanat/fsql/releases/download/fsql-v#{version}/fsql-#{version}-amd64"
    end
    caveats "Needs glibc 2.34."
  end

  name "fsql"
  desc "Query and modify the \\"filesystem\\" with \\#{SQL}"
  homepage "https://github.com/kjanat/fsql"

  livecheck do
    url :url
    regex(/^fsql-v(\\d+(?:\\.\\d+)+)$/i)
    strategy :github_latest
  end

  container type: :naked
  binary "fsql"

  preflight_steps do
    move "fsql-*", "fsql", source_glob: true
    set_permissions "fsql", "755", recursive: false
  end

  caveats "Restart your shell."

  zap :not_required
end
`);
});

test('a cask refuses missing checksums, a tag without its version and paths outside the staged cask', async () => {
	const failure = async (options: Parameters<typeof generateCask>[0]) => {
		const result = await run(generateCask(options));
		return result._tag === 'Failure' ? result.failure.message : 'generated';
	};
	expect(await failure({ configuration: kprintCask, version: '0.61.0', tag: '0.61.0', checksums: '' })).toBe(
		'Checksum missing for kprint-aarch64-apple-darwin.zip',
	);
	expect(await failure({ configuration: kprintCask, version: '0.61.0', tag: 'latest', checksums })).toBe(
		'Release tag latest does not contain 0.61.0',
	);
	expect(
		await failure({
			configuration: { ...kprintCask, binaries: [{ path: '../kprint' }] },
			version: '0.61.0',
			tag: '0.61.0',
			checksums,
		}),
	).not.toBe('generated');
	expect(
		await failure({
			configuration: { ...kprintCask, url: 'http://github.com/{asset}' },
			version: '0.61.0',
			tag: '0.61.0',
			checksums,
		}),
	).toBe('Expected an HTTPS release URL');
	const mixed = { ...kprintCask, naked: { glob: 'kprint-*', name: 'kprint' } };
	expect(homebrewConfiguration.safeParse(mixed).error?.issues.map(issue => issue.message)).toEqual([
		'Expected one platform, macos or linux, with naked',
	]);
	expect(await failure({ configuration: mixed, version: '0.61.0', tag: '0.61.0', checksums })).not.toBe('generated');
});

test('a cask url percent-encodes the tag and asset and keeps the version interpolation', async () => {
	const result = await run(generateCask({
		configuration: {
			token: 'tool',
			name: 'tool',
			desc: 'Tool',
			homepage: 'https://example.com',
			url: 'https://example.com/download/{tag}/{asset}',
			macos: { arm: 'tool#mac-{version}-arm.zip', intel: 'tool#mac-{version}-intel.zip' },
			binaries: [{ path: 'tool' }],
		},
		version: '1.2.3',
		tag: 'rel/v1.2.3',
		checksums: `${digest('1')}  tool#mac-1.2.3-arm.zip\n${digest('2')}  tool#mac-1.2.3-intel.zip\n`,
	}));
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(result.success).toContain(
		'url "https://example.com/download/rel%2Fv#{version}/tool%23mac-#{version}-arm.zip"',
	);
	expect(result.success).toContain(
		'url "https://example.com/download/rel%2Fv#{version}/tool%23mac-#{version}-intel.zip"',
	);
});

const kprintScoop: ScoopConfiguration = {
	name: 'kprint',
	description: 'Pluggable and configurable code formatter written in Rust, forked from dprint',
	homepage: 'https://dprint.kjanat.dev',
	license: 'MIT',
	url: 'https://github.com/kjanat/kprint/releases/download/{tag}/{asset}',
	architecture: { arm64: 'kprint-aarch64-pc-windows-msvc.zip', '64bit': 'kprint-x86_64-pc-windows-msvc.zip' },
	bin: ['kprint.exe', ['kprint.exe', 'dprint']],
};

test('a Scoop manifest lists each architecture with its download, executables and lowercase hash', async () => {
	const result = await run(
		generateManifest({ configuration: kprintScoop, version: '0.61.0', tag: '0.61.0', checksums }),
	);
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	const bin = ['kprint.exe', ['kprint.exe', 'dprint']];
	expect(result.success).toBe(`${
		JSON.stringify(
			{
				version: '0.61.0',
				architecture: {
					'64bit': {
						url: 'https://github.com/kjanat/kprint/releases/download/0.61.0/kprint-x86_64-pc-windows-msvc.zip',
						bin,
						hash: digest('e'),
					},
					arm64: {
						url: 'https://github.com/kjanat/kprint/releases/download/0.61.0/kprint-aarch64-pc-windows-msvc.zip',
						bin,
						hash: digest('f'),
					},
				},
				homepage: 'https://dprint.kjanat.dev',
				license: 'MIT',
				description: 'Pluggable and configurable code formatter written in Rust, forked from dprint',
			},
			null,
			4,
		)
	}\n`);
});

test('a Scoop manifest refuses a missing checksum and an executable outside the archive', async () => {
	const withoutArm = checksums.split('\n').filter(line => !line.includes('aarch64-pc-windows')).join('\n');
	const missing = await run(generateManifest({ configuration: kprintScoop, version: '0.61.0', checksums: withoutArm }));
	expect(missing._tag === 'Failure' && missing.failure.message).toBe(
		'Checksum missing for kprint-aarch64-pc-windows-msvc.zip',
	);
	const outside = await run(generateManifest({
		configuration: { ...kprintScoop, bin: ['..\\kprint.exe'] },
		version: '0.61.0',
		tag: '0.61.0',
		checksums,
	}));
	expect(outside._tag).toBe('Failure');
});

test('a Scoop manifest refuses rooted executables and shim aliases with a path', async () => {
	const refused = async (bin: ScoopConfiguration['bin']) => {
		const configuration = { ...kprintScoop, bin };
		const result = await run(generateManifest({ configuration, version: '0.61.0', tag: '0.61.0', checksums }));
		return result._tag === 'Failure'
			? JSON.stringify(scoopConfiguration.safeParse(configuration).error?.issues)
			: 'generated';
	};
	expect(await refused(['C:\\build\\kprint.exe'])).toContain('Expected a relative path inside the archive');
	expect(await refused(['\\\\server\\share\\kprint.exe'])).toContain('Expected a relative path inside the archive');
	expect(await refused(['/kprint.exe'])).toContain('Expected a relative path inside the archive');
	expect(await refused([['kprint.exe', '../apps/other/current/other']])).toContain(
		'Expected a shim name without a path',
	);
	expect(await refused([['kprint.exe', '..']])).toContain('Expected a shim name without a path');
	expect(await refused(['bin\\kprint.exe', ['bin/kprint.exe', 'dprint']])).toBe('generated');
});

test('a generated file is reported in GITHUB_OUTPUT, or on stderr outside a workflow', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-rendered-'));
	const rendered = (name: string) => Effect.succeed({ name, content: 'content\n' });
	const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
	try {
		const output = join(directory, 'output');
		await withEnvironment(
			{ GITHUB_OUTPUT: output },
			() => Effect.runPromise(writeRendered(directory, rendered('tool.rb'), () => {})),
		);
		expect(await readFile(join(directory, 'tool.rb'), 'utf8')).toBe('content\n');
		expect(await readFile(output, 'utf8')).toMatch(
			new RegExp(`^file<<(value_[0-9a-f-]+)\\n${join(directory, 'tool.rb')}\\n\\1\\n$`),
		);
		expect(stderr).not.toHaveBeenCalled();
		await withEnvironment(
			{ GITHUB_OUTPUT: '' },
			() => Effect.runPromise(writeRendered(directory, rendered('tool.json'), () => {})),
		);
		expect(await readFile(output, 'utf8')).not.toContain('tool.json');
		expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toContain(`\n${join(directory, 'tool.json')}\n`);
	} finally {
		stderr.mockRestore();
		await rm(directory, { recursive: true, force: true });
	}
});

test('WinGet manifests keep uppercase hashes from the shared checksum parser', async () => {
	const result = await run(generateManifests({
		configuration: {
			packageIdentifier: 'Kjanat.Kprint',
			releaseNotesUrl: 'https://github.com/kjanat/kprint/releases/tag/{tag}',
			metadata: {
				Publisher: 'kjanat',
				PackageName: 'kprint',
				License: 'MIT',
				ShortDescription: 'Code formatter',
			},
			installer: {
				InstallerType: 'zip',
				NestedInstallerType: 'portable',
				NestedInstallerFiles: [{ RelativeFilePath: 'kprint.exe' }],
			},
			installers: [{
				architecture: 'x64',
				asset: 'kprint-x86_64-pc-windows-msvc.zip',
				url: 'https://github.com/kjanat/kprint/releases/download/{tag}/{asset}',
			}],
		},
		version: '0.61.0',
		tag: '0.61.0',
		releaseDate: '2026-11-12',
		checksums,
		releaseNotes: 'Notes',
	}));
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(result.success.installer.Installers.map(installer => installer.InstallerSha256)).toEqual([digest('E')]);
});
