import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withEnvironment } from '@root/test/support/process.ts';
import { Effect, Schema, Struct } from 'effect';
import { managerNames, managerSpec } from '@/domain/catalog.ts';
import type { Package } from '@/domain/inventory.ts';
import { writeRendered } from '@/host/rendered-file.ts';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/kernel/schema/structs.ts';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/kernel/schema/structs.ts';
import type { HomebrewConfiguration } from '@/publication/distribution/homebrew.ts';
import { generateCask } from '@/publication/distribution/homebrew.ts';
import type { ScoopConfiguration } from '@/publication/distribution/scoop.ts';
import { generateManifest, scoopConfiguration } from '@/publication/distribution/scoop.ts';
import { generateManifests, wingetConfiguration } from '@/publication/distribution/winget/generate.ts';
import type { Publication } from '@/publication/publication.ts';
import { managerRegistry } from '@/publication/registries/builtins.ts';
import { cargoManager, crateIndexUrl } from '@/publication/registries/cargo.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import { verifyPublication } from '@/publication/registries/verify.ts';
import { vscodeManager } from '@/publication/registries/vscode.ts';
import { ToolFailure } from '@/tooling/runtime';

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

test('a naked cask for macOS and Linux moves the download on both and clears quarantine on macOS', async () => {
	const result = await run(generateCask({
		configuration: {
			token: 'fsql',
			name: 'fsql',
			desc: 'Query and modify the filesystem with SQL',
			homepage: 'https://github.com/kjanat/fsql',
			url: 'https://github.com/kjanat/fsql/releases/download/{tag}/{asset}',
			macos: { arm: 'fsql-aarch64-apple-darwin', intel: 'fsql-x86_64-apple-darwin' },
			linux: { arm: 'fsql-aarch64-unknown-linux-gnu', intel: 'fsql-x86_64-unknown-linux-gnu' },
			naked: { glob: 'fsql-*', name: 'fsql' },
			binaries: [{ path: 'fsql' }],
		},
		version: '0.2.0',
		checksums: [
			`${digest('1')}  fsql-aarch64-apple-darwin`,
			`${digest('2')}  fsql-x86_64-apple-darwin`,
			`${digest('3')}  fsql-aarch64-unknown-linux-gnu`,
			`${digest('4')}  fsql-x86_64-unknown-linux-gnu`,
		].join('\n'),
	}));
	if (result._tag === 'Failure') throw new Error(result.failure.message);
	expect(result.success).toContain(`
  container type: :naked
  binary "fsql"

  preflight_steps do
    move "fsql-*", "fsql", source_glob: true
    set_permissions "fsql", "755", recursive: false
    on_macos do
      run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}"]
    end
  end
`);
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
			? JSON.stringify(safeDecode(scoopConfiguration, configuration).error?.issues)
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

test('WinGet rejects installer typos and maps malformed release URLs to CLI failures', async () => {
	const configuration = {
		packageIdentifier: 'Kjanat.Kprint',
		releaseNotesUrl: 'https://example.com/{tag}',
		metadata: { Publisher: 'kjanat', PackageName: 'kprint', License: 'MIT', ShortDescription: 'Code formatter' },
		installer: { InstallerType: 'portable' },
		installers: [{ architecture: 'x64', asset: 'kprint.exe', url: 'https://example.com/{asset}' }],
	} as const;
	expect(
		safeDecode(wingetConfiguration, {
			...configuration,
			installer: { ...configuration.installer, InstallerSwitchess: { Silent: '/S' } },
		}).success,
	).toBe(false);
	for (const position of ['releaseNotes', 'installer']) {
		const result = await run(
			generateManifests({
				configuration: {
					...configuration,
					releaseNotesUrl: position === 'releaseNotes' ? 'https://' : configuration.releaseNotesUrl,
					installers: configuration.installers.map(installer => ({
						...installer,
						url: position === 'installer' ? 'not a URL' : installer.url,
					})),
				},
				version: '1.0.0',
				releaseDate: '2026-11-12',
				checksums: `${digest('a')}  kprint.exe`,
				releaseNotes: 'Notes',
			}).pipe(Effect.mapError(error => new ToolFailure({ message: error.message, cause: error }))),
		);
		expect(result._tag === 'Failure' && result.failure._tag).toBe('ToolFailure');
		expect(result._tag === 'Failure' && result.failure.message).toBe('Expected an HTTPS release URL');
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

test('verification outcomes keep the stored publication shape', () => {
	const publication: Publication = {
		id: 'pkg:cargo/svg-data',
		manager: 'cargo',
		name: 'svg-data',
		version: '0.5.0',
		digest: 'a'.repeat(64),
		outcome: 'pending',
		required: true,
	};
	const url = 'https://index.crates.io/sv/g-/svg-data';
	const stored = (outcome: CheckOutcome) => JSON.stringify(verifiedPublication(publication, outcome));
	expect(stored(VerificationOutcome.Published({ version: '0.5.0', url, digest: 'b'.repeat(64) })))
		.toBe(JSON.stringify({ ...publication, outcome: 'succeeded', url, digest: 'b'.repeat(64) }));
	expect(stored(VerificationOutcome.Published({ version: '0.5.0', url })))
		.toBe(JSON.stringify({ ...publication, outcome: 'succeeded', url }));
	expect(stored(VerificationOutcome.Pending({ url }))).toBe(
		JSON.stringify({ ...publication, outcome: 'pending', url }),
	);
	expect(stored(VerificationOutcome.Rejected({ url }))).toBe(
		JSON.stringify({ ...publication, outcome: 'failed', url }),
	);
	expect(stored(VerificationOutcome.Rejected({}))).toBe(JSON.stringify({ ...publication, outcome: 'failed' }));
	expect(stored(VerificationOutcome.LookupFailed({ url, reason: 'HTTP 503' })))
		.toBe(JSON.stringify({ ...publication, outcome: 'uncertain', url }));
	expect(stored(VerificationOutcome.Unverifiable())).toBe(JSON.stringify({ ...publication, outcome: 'uncertain' }));
});

test('registry checks return a verification outcome for each verdict', async () => {
	const publication = (manager: Publication['manager'], name: string, version = '1.0.0'): Publication => ({
		id: `pkg:${manager}/${name}`,
		manager,
		name,
		version,
		outcome: 'pending',
		required: true,
	});
	const unused = () => Promise.reject(new Error('unexpected request'));
	const check = (effect: Effect.Effect<CheckOutcome>) => Effect.runPromise(effect);
	expect(await check(verifyPublication(publication('workflow', 'release'), unused)))
		.toEqual(VerificationOutcome.Unverifiable());
	expect(await check(verifyPublication(publication('jsr', 'widget'), unused))).toEqual(
		VerificationOutcome.Rejected({}),
	);
	expect(await check(verifyPublication(publication('oci', 'quay.io/octo/widget'), unused)))
		.toEqual(VerificationOutcome.Rejected({}));
	expect(await check(verifyPublication(publication('goreleaser', 'widget'), unused)))
		.toEqual(VerificationOutcome.Unverifiable());
	const release = (found: unknown) => ({ repository: 'octo/widget', github: () => Effect.succeed(found) });
	const tagUrl = 'https://github.com/octo/widget/releases/tag/v1.0.0';
	expect(await check(verifyPublication(publication('goreleaser', 'widget'), unused, release(null))))
		.toEqual(VerificationOutcome.Pending({ url: tagUrl }));
	expect(
		await check(verifyPublication(
			publication('goreleaser', 'widget'),
			unused,
			release({ tag_name: 'v1.0.0', draft: false, assets: [{ state: 'uploaded' }] }),
		)),
	).toEqual(VerificationOutcome.Published({ version: '1.0.0', url: tagUrl }));

	const openVsx = vscodeManager.secondaryPublication?.['open-vsx'];
	if (!openVsx) throw new Error('Missing Open VSX check');
	const extensionUrl = 'https://open-vsx.org/api/octo/widget/1.0.0';
	expect(await check(openVsx(publication('vscode', 'widget'), unused))).toEqual(VerificationOutcome.Unverifiable());
	expect(
		await check(
			openVsx(publication('vscode', 'octo.widget'), () => Promise.resolve(Response.json({ version: '1.0.0' }))),
		),
	)
		.toEqual(VerificationOutcome.Published({ version: '1.0.0', url: extensionUrl }));
	expect(
		await check(
			openVsx(publication('vscode', 'octo.widget'), () => Promise.resolve(Response.json({ version: '0.9.0' }))),
		),
	)
		.toEqual(VerificationOutcome.LookupFailed({ url: extensionUrl, reason: 'invalid registry response' }));

	const moduleUrl = 'https://proxy.golang.org/example.com/widget/@v/v1.0.0.info';
	const proxy = () => Promise.resolve(Response.json({ Version: 'v1.0.0' }));
	expect(await check(verifyPublication(publication('go', 'example.com/widget'), proxy)))
		.toEqual(VerificationOutcome.Published({ version: '1.0.0', url: moduleUrl }));
	expect(await check(verifyPublication({ ...publication('go', 'example.com/widget'), digest: 'h1' }, proxy)))
		.toEqual(VerificationOutcome.LookupFailed({ url: moduleUrl, reason: 'no origin hash' }));

	const manifest = new TextEncoder().encode('{"schemaVersion":2}');
	const digest = `sha256:${new Bun.CryptoHasher('sha256').update(manifest).digest('hex')}`;
	const imageUrl = 'https://ghcr.io/v2/octo/widget/manifests/1.0.0';
	expect(
		await check(verifyPublication(
			{ ...publication('oci', 'ghcr.io/octo/widget'), digest, channel: 'latest' },
			input =>
				Promise.resolve(
					String(input).endsWith('/1.0.0')
						? new Response(manifest, { headers: { 'docker-content-digest': digest } })
						: new Response(null, { status: 404 }),
				),
		)),
	).toEqual(VerificationOutcome.Pending({ url: imageUrl }));
});

test('a crate that the crates.io API cannot answer is checked in the sparse index', async () => {
	const publication: Publication = {
		id: 'pkg:cargo/svg-data',
		manager: 'cargo',
		name: 'svg-data',
		version: '0.5.0',
		outcome: 'pending',
		required: true,
	};
	const index = (lines: string[]) => async (input: string | URL | Request) => {
		const url = new URL(input instanceof Request ? input.url : input);
		if (url.host === 'crates.io') return new Response(null, { status: 503 });
		expect(url.toString()).toBe('https://index.crates.io/sv/g-/svg-data');
		return lines.length ? new Response(`${lines.join('\n')}\n`) : new Response(null, { status: 404 });
	};
	const url = 'https://index.crates.io/sv/g-/svg-data';
	const verify = (lines: string[], expected: Publication = publication) =>
		Effect.runPromise(verifyPublication(expected, index(lines)));
	expect(await verify([])).toEqual(VerificationOutcome.Pending({ url }));
	expect(await verify([JSON.stringify({ name: 'svg-data', vers: '0.4.0', cksum: 'a'.repeat(64), yanked: false })]))
		.toEqual(VerificationOutcome.Pending({ url }));
	const listed = [JSON.stringify({ name: 'svg-data', vers: '0.5.0', cksum: 'b'.repeat(64), yanked: false })];
	expect(await verify(listed)).toEqual(
		VerificationOutcome.Published({ version: '0.5.0', url, digest: 'b'.repeat(64) }),
	);
	expect(await verify([JSON.stringify({ name: 'svg-data', vers: '0.5.0', cksum: 'b'.repeat(64), yanked: true })]))
		.toEqual(VerificationOutcome.Rejected({ url }));
	expect(await verify(['{"name":"svg-data","vers":"0.5.0"', JSON.stringify({ name: 'svg-data', vers: '0.4.0' })]))
		.toEqual(VerificationOutcome.LookupFailed({ url, reason: 'invalid registry response' }));
	expect(await verify(listed, { ...publication, digest: 'c'.repeat(64) })).toEqual(
		VerificationOutcome.Rejected({ url }),
	);
	expect(crateIndexUrl('ab')).toBe('https://index.crates.io/2/ab');
	expect(crateIndexUrl('Abc')).toBe('https://index.crates.io/3/a/abc');
});

test('a crate whose latest version the crates.io API cannot answer is read from the sparse index', async () => {
	const pkg: Package = {
		manager: 'cargo',
		name: 'svg-data',
		version: '0.5.0',
		manifest: 'Cargo.toml',
		versionSource: 'manifest:Cargo.toml',
		publication: { kind: 'registry' },
		dependencies: [],
	};
	const latest = (body: string | null) =>
		Effect.runPromise(
			cargoManager.latest?.(
				pkg,
				async input => {
					const url = new URL(input instanceof Request ? input.url : input);
					if (url.host === 'crates.io') return new Response(null, { status: 503 });
					return body === null ? new Response(null, { status: 404 }) : new Response(body);
				},
			) ?? Effect.die('cargo has no latest lookup'),
		);
	const line = (vers: string, yanked = false) =>
		JSON.stringify({ name: 'svg-data', vers, cksum: 'a'.repeat(64), yanked });
	expect(await latest([line('0.3.0'), line('0.4.0'), line('0.5.0-rc.1'), line('0.4.1', true)].join('\n')))
		.toEqual(VerificationOutcome.Published({ version: '0.4.0' }));
	expect(await latest([line('1.1.0'), line('1.2.0+vendor-build')].join('\n')))
		.toEqual(VerificationOutcome.Published({ version: '1.2.0+vendor-build' }));
	expect(await latest(null)).toEqual(VerificationOutcome.Missing({ url: 'https://index.crates.io/sv/g-/svg-data' }));
	expect(await latest('{"name"')).toEqual(VerificationOutcome.LookupFailed({
		url: 'https://index.crates.io/sv/g-/svg-data',
		reason: 'invalid registry response',
	}));
});

test('the catalog marks a manager verifiable exactly when its adapter verifies publications', () => {
	expect(managerNames.map(name => [name, managerSpec(name).verifiable])).toEqual(
		managerNames.map(name => [name, managerRegistry.canVerify(name)]),
	);
});
