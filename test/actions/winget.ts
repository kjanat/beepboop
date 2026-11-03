import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const configuration = JSON.parse(readFileSync('examples/winget/package.json', 'utf8'));
const options = {
	version: '1.2.3',
	releaseDate: '2026-10-22',
	checksums: `${'a'.repeat(64)}  tool_1.2.3_windows_amd64.zip\n${'b'.repeat(64)}  tool_1.2.3_windows_arm64.zip\n`,
	releaseNotes: 'Release notes',
};
test('WinGet Action source runs with Bun from the consumer directory', () => {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-winget-action-'));
	try {
		writeFileSync(join(root, 'package.json'), JSON.stringify(configuration));
		writeFileSync(join(root, 'checksums.txt'), options.checksums);
		writeFileSync(join(root, 'notes.md'), options.releaseNotes);
		const entry = new URL('../../src/distribution/winget/cli.ts', import.meta.url).pathname;
		const run = spawnSync(process.execPath, [entry], {
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

test('every composite Action selects setup-bun only when Bun is absent', () => {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-bun-detection-'));
	try {
		const bin = join(root, 'bin');
		mkdirSync(bin);
		for (const name of ['begin', 'credentials', 'generate-winget', 'prepare', 'publish-refs', 'report', 'token']) {
			const action = parse(readFileSync(`actions/${name}/action.yml`, 'utf8'));
			const [detect, setup] = action.runs.steps;
			expect(setup.uses).toBe('oven-sh/setup-bun@v2');
			expect(setup.with['bun-version']).toBe('latest');
			expect(setup.if).toBe("steps.bun.outputs.available != 'true'");
			for (const present of [false, true]) {
				const executable = join(bin, 'bun');
				if (present) writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
				else rmSync(executable, { force: true });
				const output = join(root, 'output');
				writeFileSync(output, '');
				const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', detect.run], {
					env: { ...process.env, PATH: bin, GITHUB_OUTPUT: output },
					encoding: 'utf8',
				});
				expect(result.status, result.stderr).toBe(0);
				expect(readFileSync(output, 'utf8')).toBe(present ? 'available=true\n' : '');
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
