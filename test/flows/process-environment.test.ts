import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('action fixtures ignore the enclosing workflow context and leave its output files untouched', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-outer-workflow-'));
	try {
		const output = join(directory, 'output'), environment = join(directory, 'env');
		await writeFile(output, 'outer output\n');
		await writeFile(environment, 'outer environment\n');
		const child = Bun.spawn([
			process.execPath,
			'test',
			'test/flows/observation.test.ts',
			'--test-name-pattern',
			'a run that registers itself records the namespace',
		], {
			cwd: resolve(import.meta.dir, '../..'),
			env: {
				PATH: process.env.PATH ?? '',
				HOME: process.env.HOME ?? '',
				BEEPBOOP_EXECUTION_ID: 'outer-workflow-execution',
				RELEASE_VERSION: '9.9.9',
				SERVICE_ORIGIN: 'https://outer-workflow.invalid',
				ACTIONS_ID_TOKEN_REQUEST_URL: 'https://outer-workflow.invalid/token',
				ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'outer-token',
				GITHUB_OUTPUT: output,
				GITHUB_ENV: environment,
				RUNNER_TEMP: directory,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ exitCode, failed: `${stdout}${stderr}`.includes('(fail)') }).toEqual({ exitCode: 0, failed: false });
		expect(stderr).toContain('1 pass');
		expect(await readFile(output, 'utf8')).toBe('outer output\n');
		expect(await readFile(environment, 'utf8')).toBe('outer environment\n');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);
