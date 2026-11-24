import { test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('holds a temporary directory until it is stopped', async () => {
	mkdtempSync(join(tmpdir(), 'beepboop-held-'));
	await Bun.sleep(30_000);
});
