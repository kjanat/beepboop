import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { HomebrewConfiguration } from '@/distribution/homebrew/generate';
import { generateCask } from '@/distribution/homebrew/generate';
import type { ScoopConfiguration } from '@/distribution/scoop/generate';
import { generateManifest } from '@/distribution/scoop/generate';
import { generateManifests } from '@/distribution/winget/generate';

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
