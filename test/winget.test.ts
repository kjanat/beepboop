import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { GenerateOptions, WingetConfiguration } from '../src/distribution/winget/generate.ts';
import {
	capReleaseNotes,
	generateManifests,
	parseChecksums,
	renderManifests,
} from '../src/distribution/winget/generate.ts';
import { installerManifest } from '../src/distribution/winget/schema.ts';

const configuration = JSON.parse(
	readFileSync(new URL('../examples/winget/package.json', import.meta.url), 'utf8'),
) as WingetConfiguration;
const options: GenerateOptions = {
	configuration,
	version: '1.2.3',
	releaseDate: '2026-10-22',
	checksums: `${'a'.repeat(64)}  tool_1.2.3_windows_amd64.zip\n${'b'.repeat(64)}  tool_1.2.3_windows_arm64.zip\n`,
	releaseNotes:
		'# Changes\n\n- **Faster** checks\n- Fixed [the bug](https://example.test)\n\n```sh\ntool --version\n```',
};
test('WinGet produces three valid package-specific manifests', () => {
	const manifests = generateManifests(options), files = renderManifests(manifests);
	expect(Object.keys(files)).toEqual([
		'Example.Tool.yaml',
		'Example.Tool.installer.yaml',
		'Example.Tool.locale.en-US.yaml',
	]);
	expect(installerManifest.parse(parse(files['Example.Tool.installer.yaml'] ?? ''))).toEqual(manifests.installer);
	expect(manifests.installer.Installers[0]?.InstallerSha256).toBe('A'.repeat(64));
	expect(manifests.installer.Installers[0]?.InstallerUrl).toBe(
		'https://github.com/example/tool/releases/download/v1.2.3/tool_1.2.3_windows_amd64.zip',
	);
	expect(manifests.installer.InstallationMetadata?.Files?.[0]?.InvocationParameter).toBe('--version');
	expect(manifests.installer).not.toHaveProperty('InstallerSuccessCodes');
	expect(manifests.defaultLocale.ReleaseNotes).toContain('- Faster checks');
	expect(manifests.defaultLocale.ReleaseNotes).not.toContain('**');
	expect(renderManifests(generateManifests(options))).toEqual(files);
});
test('WinGet has no fixed repository, executable or package identity', () => {
	const custom = {
		...options,
		configuration: {
			...configuration,
			packageIdentifier: 'Other.Cli',
			defaultLocale: 'de-DE',
			metadata: {
				Publisher: 'Other',
				PackageName: 'Other CLI',
				License: 'Apache-2.0',
				ShortDescription: 'A different program',
			},
			installer: { InstallerType: 'portable' as const, Commands: ['different'] },
			installers: [{
				architecture: 'x86' as const,
				asset: 'different.exe',
				url: 'https://downloads.example.test/{asset}',
			}],
		},
		checksums: `${'c'.repeat(64)} *different.exe`,
	};
	const manifests = generateManifests(custom);
	expect(manifests.installer.Installers[0]?.Architecture).toBe('x86');
	expect(manifests.installer.Commands).toEqual(['different']);
	expect(Object.keys(renderManifests(manifests))).toContain('Other.Cli.locale.de-DE.yaml');
});
test('WinGet rejects missing and duplicate checksums and invalid metadata', () => {
	expect(() => generateManifests({ ...options, checksums: '' })).toThrow('Checksum missing');
	expect(() => parseChecksums(`${'a'.repeat(64)}  file\n${'b'.repeat(64)}  file`)).toThrow('Duplicate');
	expect(() => generateManifests({ ...options, version: '1.2.3-beta.1' })).toThrow('stable');
	expect(() => generateManifests({ ...options, releaseDate: '2026-02-30' })).toThrow();
	expect(() => generateManifests({ ...options, configuration: { ...configuration, packageIdentifier: '../evil' } }))
		.toThrow();
	expect(() =>
		generateManifests({
			...options,
			configuration: {
				...configuration,
				installers: [{ architecture: 'x64', asset: '{unknown}', url: 'https://example.test/{asset}' }],
			},
		})
	).toThrow('Unknown');
	expect(() =>
		generateManifests({
			...options,
			configuration: {
				...configuration,
				installer: {
					InstallerType: 'zip',
					NestedInstallerType: 'portable',
					NestedInstallerFiles: [{ RelativeFilePath: '../tool.exe' }],
				},
			},
		})
	).toThrow('Unsafe');
});
test('long release notes fit the schema and link to the full release', () => {
	const url = 'https://example.test/release';
	const notes = capReleaseNotes('A paragraph.\n\n'.repeat(1500), url);
	expect(notes.length).toBeLessThanOrEqual(10000);
	expect(notes.endsWith(`Full release notes: ${url}`)).toBe(true);
});
test('WinGet CLI writes files for the supplied configuration', () => {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-winget-'));
	try {
		writeFileSync(join(root, 'package.json'), JSON.stringify(configuration));
		writeFileSync(join(root, 'checksums.txt'), options.checksums);
		writeFileSync(join(root, 'notes.md'), options.releaseNotes);
		const run = spawnSync('bun', [
			'scripts/winget.ts',
			'--config',
			join(root, 'package.json'),
			'--version',
			options.version,
			'--checksums',
			join(root, 'checksums.txt'),
			'--release-notes',
			join(root, 'notes.md'),
			'--release-date',
			options.releaseDate,
			'--out',
			join(root, 'out'),
		], { encoding: 'utf8' });
		expect(run.status, run.stderr).toBe(0);
		expect(readFileSync(join(root, 'out', 'Example.Tool.yaml'), 'utf8')).toContain('PackageVersion: 1.2.3');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('bundled WinGet Action runs with Node without installing dependencies in the consumer', () => {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-winget-action-'));
	try {
		writeFileSync(join(root, 'package.json'), JSON.stringify(configuration));
		writeFileSync(join(root, 'checksums.txt'), options.checksums);
		writeFileSync(join(root, 'notes.md'), options.releaseNotes);
		const entry = new URL('../dist/winget/cli.mjs', import.meta.url).pathname;
		const run = spawnSync('node', [entry], {
			cwd: root,
			encoding: 'utf8',
			env: {
				...process.env,
				WINGET_CONFIG: join(root, 'package.json'),
				WINGET_VERSION: options.version,
				WINGET_TAG: '',
				WINGET_CHECKSUMS: join(root, 'checksums.txt'),
				WINGET_RELEASE_NOTES: join(root, 'notes.md'),
				WINGET_RELEASE_DATE: options.releaseDate,
				WINGET_OUT: join(root, 'out'),
				GITHUB_OUTPUT: join(root, 'outputs'),
			},
		});
		expect(run.status, run.stderr).toBe(0);
		expect(readFileSync(join(root, 'out', 'Example.Tool.installer.yaml'), 'utf8')).toContain(
			`InstallerSha256: ${'A'.repeat(64)}`,
		);
		expect(readFileSync(join(root, 'outputs'), 'utf8')).toContain('files=[');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
