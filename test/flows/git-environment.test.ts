import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { repositoryVariablesIn, withoutRepository } from '@root/test/support/git-environment.ts';

const root = join(import.meta.dir, '../..');
const hook = {
	GIT_DIR: '/nonexistent/hook/git-dir',
	GIT_INDEX_FILE: '/nonexistent/hook/index',
	GIT_CONFIG_KEY_0: 'core.bare',
};

test('hook variables that locate a repository are dropped and the rest are kept', () => {
	const environment = { ...hook, GIT_EDITOR: 'vi', PATH: '/usr/bin' };
	expect(repositoryVariablesIn(environment).sort()).toEqual(['GIT_CONFIG_KEY_0', 'GIT_DIR', 'GIT_INDEX_FILE']);
	expect(withoutRepository(environment)).toEqual({ GIT_EDITOR: 'vi', PATH: '/usr/bin' });
});

test('bun test refuses to run under a git hook environment', () => {
	const run = Bun.spawnSync(['bun', 'test', 'test/flows/package-identity.test.ts'], {
		cwd: root,
		env: { ...withoutRepository(process.env), ...hook },
	});
	expect(run.exitCode).toBe(1);
	expect(run.stderr.toString()).toContain('Run them through `bun run test`');
});

test('the test launcher runs tests under a git hook environment', () => {
	const run = Bun.spawnSync(['bun', 'scripts/test.ts', 'test/flows/package-identity.test.ts'], {
		cwd: root,
		env: { ...withoutRepository(process.env), ...hook },
	});
	expect(run.exitCode).toBe(0);
});
