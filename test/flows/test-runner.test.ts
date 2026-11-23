import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;

function runner(fixture: string, temp: string) {
	return Bun.spawn(['bun', 'scripts/test.ts', `./test/fixtures/runner/${fixture}`], {
		cwd: root,
		env: { ...process.env, TMPDIR: temp },
		stdout: 'pipe',
		stderr: 'pipe',
	});
}

function held(temp: string): boolean {
	return readdirSync(temp).some(run => readdirSync(join(temp, run)).some(name => name.startsWith('beepboop-held-')));
}

test('bun run test removes the temporary files its tests leave', async () => {
	const temp = mkdtempSync(join(tmpdir(), 'beepboop-test-runner-'));
	try {
		expect(await runner('leaves-temp.ts', temp).exited).toBe(0);
		expect(readdirSync(temp)).toEqual([]);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test.each(['SIGINT', 'SIGTERM'] as const)('bun run test stopped with %s removes the temporary files', async signal => {
	const temp = mkdtempSync(join(tmpdir(), 'beepboop-test-runner-'));
	try {
		const child = runner('waits.ts', temp);
		for (let waited = 0; !held(temp) && waited < 10_000; waited += 20) await Bun.sleep(20);
		expect(held(temp)).toBe(true);
		child.kill(signal);
		expect(await child.exited).not.toBe(0);
		expect(readdirSync(temp)).toEqual([]);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
