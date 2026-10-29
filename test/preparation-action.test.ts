import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('preparation Action applies group edits and submits unchanged lockfiles', () => {
	const root = mkdtempSync(join(tmpdir(), 'preparation-action-'));
	const action = resolve('actions/runtime/prepare.mjs');
	const git = (...args: string[]) => {
		const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(result.stderr);
		return result.stdout.trim();
	};
	try {
		git('init', '-q');
		writeFileSync(join(root, 'version.txt'), '1.0.0\n');
		writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
		git('add', 'version.txt', 'package-lock.json');
		git(
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'-qm',
			'fixture',
		);
		const context = {
			id: 'fixture',
			operation: 'prepare',
			sourceSha: git('rev-parse', 'HEAD'),
			plan: {
				groups: [{ id: 'tool', version: '2.0.0' }],
				edits: [{ path: 'version.txt', before: '1.0.0\n', after: '2.0.0\n' }],
				lockfiles: ['package-lock.json'],
			},
		};
		const run = (mode: string) =>
			spawnSync(process.execPath, [action], {
				cwd: root,
				encoding: 'utf8',
				env: {
					...process.env,
					RELEASE_CONTEXT: JSON.stringify(context),
					PREPARATION_MODE: mode,
					GITHUB_WORKSPACE: root,
					RUNNER_TEMP: root,
					GITHUB_ENV: join(root, 'github-env'),
				},
			});
		expect(run('apply').status).toBe(0);
		expect(readFileSync(join(root, 'version.txt'), 'utf8')).toBe('2.0.0\n');
		expect(run('submit').status).toBe(0);
		const submitted = JSON.parse(readFileSync(join(root, 'release-prepared-fixture.json'), 'utf8'));
		expect(submitted.files).toEqual([
			{ path: 'version.txt', content: '2.0.0\n' },
			{ path: 'package-lock.json', content: '{"lockfileVersion":3}\n' },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
