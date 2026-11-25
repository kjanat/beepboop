import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { bundleRuntime, entrypoints } from '@/tooling/actions/runtime-bundle';

const examples = join(import.meta.dir, '../../examples');
const digest = (seed: string) => seed.repeat(64).slice(0, 64);
let directory = '';

beforeAll(async () => {
	directory = mkdtempSync(join(tmpdir(), 'beepboop-generator-actions-'));
	await Effect.runPromise(bundleRuntime(join(directory, 'runtime')));
	writeFileSync(
		join(directory, 'SHA256SUMS'),
		[
			'tool-1.2.3-x86_64-pc-windows-msvc.zip',
			'tool-1.2.3-aarch64-pc-windows-msvc.zip',
			'tool-1.2.3-aarch64-apple-darwin.tar.gz',
			'tool-1.2.3-x86_64-apple-darwin.tar.gz',
			'tool-1.2.3-aarch64-unknown-linux-musl.tar.gz',
			'tool-1.2.3-x86_64-unknown-linux-musl.tar.gz',
			'tool_1.2.3_windows_amd64.zip',
			'tool_1.2.3_windows_arm64.zip',
		].map((asset, index) => `${digest(String(index + 1))}  ${asset}`).join('\n') + '\n',
	);
	writeFileSync(join(directory, 'notes.md'), 'Fixes.\n');
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function generate(entry: string, environment: (out: string) => Record<string, string>) {
	const out = join(directory, entry);
	const output = join(directory, `${entry}.output`);
	writeFileSync(output, '');
	const run = Bun.spawnSync(['bun', '--no-install', join(directory, 'runtime', `${entry}.ts`)], {
		cwd: directory,
		env: { PATH: process.env.PATH ?? '', HOME: directory, GITHUB_OUTPUT: output, ...environment(out) },
		stdout: 'pipe',
		stderr: 'pipe',
	});
	return { exitCode: run.exitCode, stderr: run.stderr.toString(), out, output: readFileSync(output, 'utf8') };
}

test('bundled runtimes keep the Bun pragma and leave out source paths', () => {
	const runtime = join(directory, 'runtime');
	const comments = Object.fromEntries(
		readdirSync(runtime).map(name => [
			name,
			readFileSync(join(runtime, name), 'utf8').split('\n').filter(line => line.startsWith('// ')),
		]),
	);
	expect(comments).toEqual(Object.fromEntries(entrypoints.map(name => [`${name}.ts`, ['// @bun']])));
});

test('the bundled generator actions run without installed packages', () => {
	const scoop = generate('generate-scoop', out => ({
		SCOOP_MANIFEST_CONFIG: join(examples, 'scoop/manifest.json'),
		SCOOP_MANIFEST_VERSION: '1.2.3',
		SCOOP_MANIFEST_CHECKSUMS: join(directory, 'SHA256SUMS'),
		SCOOP_MANIFEST_OUT: out,
	}));
	const homebrew = generate('generate-homebrew', out => ({
		HOMEBREW_CASK_CONFIG: join(examples, 'homebrew/cask.json'),
		HOMEBREW_CASK_VERSION: '1.2.3',
		HOMEBREW_CASK_CHECKSUMS: join(directory, 'SHA256SUMS'),
		HOMEBREW_CASK_OUT: out,
	}));
	const winget = generate('generate-winget', out => ({
		WINGET_CONFIG: join(examples, 'winget/package.json'),
		WINGET_VERSION: '1.2.3',
		WINGET_CHECKSUMS: join(directory, 'SHA256SUMS'),
		WINGET_RELEASE_NOTES: join(directory, 'notes.md'),
		WINGET_RELEASE_DATE: '2026-11-19',
		WINGET_OUT: out,
	}));

	expect([scoop, homebrew, winget].map(run => [run.exitCode, run.stderr])).toEqual([[0, ''], [0, ''], [0, '']]);
	expect(readdirSync(scoop.out)).toEqual(['tool.json']);
	expect(readFileSync(join(scoop.out, 'tool.json'), 'utf8')).toContain(digest('1'));
	expect(readdirSync(homebrew.out).length).toBe(1);
	expect(readdirSync(winget.out).length).toBeGreaterThan(0);
	expect([scoop, homebrew, winget].every(run => run.output.length > 0)).toBe(true);
});
