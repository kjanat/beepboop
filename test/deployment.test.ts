import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '@root/package.json';

function deployment(script: string, fail = '') {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-deployment-'));
	try {
		const bin = join(root, 'node_modules', '.bin');
		mkdirSync(bin, { recursive: true });
		writeFileSync(
			join(root, 'package.json'),
			JSON.stringify({
				scripts: {
					build: 'wrangler fixture-build',
					'db:migrate': manifest.scripts['db:migrate'],
					predeploy: manifest.scripts.predeploy,
					deploy: manifest.scripts.deploy,
					'predeploy:dry': manifest.scripts['predeploy:dry'],
					'deploy:dry': manifest.scripts['deploy:dry'],
				},
			}),
		);
		writeFileSync(
			join(bin, 'wrangler'),
			`#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] === process.env.FAIL) process.exit(1);
`,
			{ mode: 0o755 },
		);
		const calls = join(root, 'calls');
		const result = spawnSync(process.execPath, ['run', script], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, CALLS: calls, FAIL: fail },
		});
		return {
			status: result.status,
			stderr: result.stderr,
			calls: readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test('deployment builds, migrates production D1, then uploads the built Worker', () => {
	const result = deployment('deploy');
	expect(result.status, result.stderr).toBe(0);
	expect(result.calls).toEqual([
		['fixture-build'],
		['d1', 'migrations', 'apply', 'beepboop', '--remote', '--config', 'wrangler.toml'],
		['deploy', '--config', 'dist/server/wrangler.json'],
	]);
});

test('failed migrations prevent Worker upload', () => {
	const result = deployment('deploy', 'd1');
	expect(result.status).not.toBe(0);
	expect(result.calls.map(args => args[0])).toEqual(['fixture-build', 'd1']);
});

test('failed builds prevent migrations and Worker upload', () => {
	const result = deployment('deploy', 'fixture-build');
	expect(result.status).not.toBe(0);
	expect(result.calls).toEqual([['fixture-build']]);
});

test('dry-run builds and validates without running remote migrations', () => {
	const result = deployment('deploy:dry');
	expect(result.status, result.stderr).toBe(0);
	expect(result.calls).toEqual([
		['fixture-build'],
		['deploy', '--config', 'dist/server/wrangler.json', '--dry-run', '--outdir', '.dry-run'],
	]);
});
