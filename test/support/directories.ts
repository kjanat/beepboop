import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function eachDirectory(prefix: string, bind: (directory: string) => void): void {
	let current: string | undefined;
	beforeEach(() => {
		current = mkdtempSync(join(tmpdir(), prefix));
		bind(current);
	});
	afterEach(() => {
		if (current) rmSync(current, { recursive: true, force: true });
	});
}
