import { test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('leaves a temporary directory behind', () => {
	mkdtempSync(join(tmpdir(), 'beepboop-left-'));
});
