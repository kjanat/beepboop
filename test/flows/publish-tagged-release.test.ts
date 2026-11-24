import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(
	new URL('../../packages/actions/actions/publish-tagged-release/publish.sh', import.meta.url),
);
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), 'beepboop-tagged-release-'));
	writeFileSync(
		join(directory, 'gh'),
		[
			'#!/usr/bin/env bash',
			'printf "%s\\n" "$GH_REPO" "$GH_TOKEN" "$@"',
			'for arg in "$@"; do',
			'  if [[ $arg == --notes-file ]]; then cat; break; fi',
			'done',
			'',
		].join('\n'),
		{ mode: 0o700 },
	);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function publish(env: Record<string, string> = {}) {
	return Bun.spawnSync(['bash', script], {
		cwd: directory,
		env: {
			PATH: `${directory}:${process.env.PATH}`,
			GH_REPO: 'test/demo',
			GH_TOKEN: 'test-app-token',
			GITHUB_REF_TYPE: 'tag',
			GITHUB_REF_NAME: 'v1.2.3',
			...env,
		},
	});
}

test('publishes only the exact changelog section and passes each downloaded asset as one argument', () => {
	const notes = [
		'',
		'### Changed',
		'Change for this release.',
		'```markdown',
		'## [example]',
		'```',
		'Notes after the fenced example.',
	];
	writeFileSync(
		join(directory, 'CHANGELOG.md'),
		[
			'# Changelog',
			'',
			'## [v1x2x3]',
			'Do not match a similar tag.',
			'',
			'## [v1.2.3] — 2026-11-23',
			...notes,
			'',
			'## [v1.2.2]',
			'Earlier change.',
		].join('\r\n'),
	);
	mkdirSync(join(directory, 'build'));
	writeFileSync(join(directory, 'build/first binary.tgz'), '');
	writeFileSync(join(directory, 'build/sha256sum.txt'), '');
	const result = publish({ RELEASE_CHANGELOG: 'CHANGELOG.md', RELEASE_ASSET_DIRECTORY: 'build' });
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().trimEnd().split('\n')).toEqual([
		'test/demo',
		'test-app-token',
		'release',
		'create',
		'--verify-tag',
		'--title',
		'v1.2.3',
		'--notes-file',
		'-',
		'--',
		'v1.2.3',
		'build/first binary.tgz',
		'build/sha256sum.txt',
		...notes,
	]);
});

test('can publish a prerelease with its own title and notes', () => {
	writeFileSync(join(directory, 'release notes.md'), 'WASI Preview 1 guest.\n');
	const result = publish({
		GITHUB_REF_NAME: 'v1.2.3-pre.1',
		RELEASE_TITLE: 'Demo preview',
		RELEASE_PRERELEASE: 'true',
		RELEASE_NOTES_FILE: 'release notes.md',
	});
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString()).toEndWith(
		'--title\nDemo preview\n--prerelease\n--latest=false\n--notes-file\n-\n--\nv1.2.3-pre.1\nWASI Preview 1 guest.\n',
	);
});

test('can generate GitHub notes without publishing assets', () => {
	const result = publish();
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString()).toEndWith('--generate-notes\n--\nv1.2.3\n');
});

test('rejects invalid release inputs before calling GitHub CLI', () => {
	writeFileSync(join(directory, 'CHANGELOG.md'), '## [v1.2.2]\nEarlier release.');
	for (
		const [env, message] of [
			[{ RELEASE_CHANGELOG: 'CHANGELOG.md' }, 'Changelog has no notes'],
			[{ GITHUB_REF_TYPE: 'branch' }, 'requires a tag ref'],
			[{ RELEASE_ASSET_DIRECTORY: 'build' }, 'Expected a release asset directory'],
			[{ GH_TOKEN: '' }, 'Missing Beepboop App token'],
			[{ RELEASE_PRERELEASE: 'true', RELEASE_LATEST: 'true' }, 'A prerelease cannot be marked Latest'],
		] as const
	) {
		const result = publish(env);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout.toString()).toBe('');
		expect(result.stderr.toString()).toContain(message);
	}
});
