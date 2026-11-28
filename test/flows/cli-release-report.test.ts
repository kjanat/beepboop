import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

const root = join(import.meta.dir, '../..');
const reported = mutableArray(mutableStruct({ manager: Schema.String, outcome: Schema.String }));

async function report(environment: Record<string, string>) {
	const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root }).stdout.toString().trim();
	const manifest = decodeSync(
		mutableStruct({ version: Schema.String }),
		JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')),
	);
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-cli-report-'));
	try {
		const output = join(directory, 'output');
		const child = Bun.spawn(['bun', 'src/tooling/cli/release.ts', 'report'], {
			cwd: root,
			env: {
				PATH: process.env.PATH ?? '',
				HOME: process.env.HOME ?? root,
				GITHUB_SHA: head,
				GITHUB_OUTPUT: output,
				RELEASE_CONTEXT: JSON.stringify({
					sourceSha: head,
					operation: 'release',
					stream: 'cli',
					version: manifest.version,
				}),
				...environment,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		});
		expect(await child.exited).toBe(0);
		const [, value] = /^publications<<(\S+)\n([\s\S]*?)\n\1$/m.exec(readFileSync(output, 'utf8'))?.slice(1) ?? [];
		return decodeSync(reported, JSON.parse(value ?? '[]')).map(entry => [entry.manager, entry.outcome]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('a cancelled release job reports unfinished publications as cancelled and keeps a known failure', async () => {
	expect(await report({ NPM_OUTCOME: 'failure', JSR_OUTCOME: 'cancelled', JOB_STATUS: 'cancelled' })).toEqual([
		['npm', 'failed'],
		['jsr', 'cancelled'],
	]);
	expect(await report({ NPM_OUTCOME: 'success', JSR_OUTCOME: 'skipped', JOB_STATUS: 'cancelled' })).toEqual([
		['npm', 'succeeded'],
		['jsr', 'cancelled'],
	]);
	expect(await report({ NPM_OUTCOME: 'success', JSR_OUTCOME: 'failure', JOB_STATUS: 'failure' })).toEqual([
		['npm', 'succeeded'],
		['jsr', 'failed'],
	]);
});
