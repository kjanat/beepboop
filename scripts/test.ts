import { withoutRepository } from '@root/test/support/git-environment.ts';

// Bun.spawn reads the environment captured at startup, so the variables a git hook exports must be gone before `bun test` starts.
const child = Bun.spawn(['bun', 'test', ...process.argv.slice(2)], {
	env: withoutRepository(process.env),
	stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(await child.exited);
