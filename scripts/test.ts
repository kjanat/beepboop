import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withoutRepository } from '@root/test/support/git-environment.ts';

// `bun test --parallel` ends its workers without running their `exit` handlers.
const temp = mkdtempSync(join(tmpdir(), 'beepboop-test-'));
// Bun.spawn reads the environment captured at startup, so the variables a git hook exports must be gone before `bun test` starts.
const child = Bun.spawn(['bun', 'test', ...process.argv.slice(2)], {
	env: { ...withoutRepository(process.env), TMPDIR: temp },
	stdio: ['inherit', 'inherit', 'inherit'],
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
const code = await child.exited;
rmSync(temp, { recursive: true, force: true });
process.exit(code);
