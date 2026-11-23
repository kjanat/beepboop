import { expect, test } from 'bun:test';
import { Effect, Exit } from 'effect';
import { generatedJsr, leakedSpecifiers } from '@/tooling/cli/manifest';

test('the CLI bundle check finds workspace specifiers in every import form', () => {
	const bundle = [
		"import { Effect } from 'effect';",
		"import { routes } from '@/contract/routes';",
		'export * from "@beepboop/kernel";',
		"const views = await import('@beepboopbot/discovery/contract.ts');",
		"require('@/cli/main');",
		"import '@/contract/views';",
		'import x from"@/a";export{y}from"@/b";',
		'__require("@/c");require.resolve("@/d");',
		"const help = 'Run beepboop auth login, see @/docs';",
		"import { cli } from '@kjanat/dreamcli';",
	].join('\n');
	expect(leakedSpecifiers(bundle)).toEqual([
		'@/contract/routes',
		'@beepboop/kernel',
		'@beepboopbot/discovery/contract.ts',
		'@/cli/main',
		'@/contract/views',
		'@/a',
		'@/b',
		'@/c',
		'@/d',
	]);
	expect(leakedSpecifiers("import { cli } from '@kjanat/dreamcli';\nimport { Effect } from 'effect';")).toEqual([]);
});

const npm = { name: '@kjanat/beepboop', version: '0.8.0' };

test('the build writes the package.json version into jsr.json and keeps its layout', async () => {
	const tabs = '{\n\t"name": "@kjanat/beepboop",\n\t"version": "0.7.2",\n\t"license": "GPL-3.0-only"\n}\n';
	expect(await Effect.runPromise(generatedJsr(npm, tabs))).toBe(tabs.replace('0.7.2', '0.8.0'));
	const spaces = '{\n  "name": "@kjanat/beepboop",\n  "license": "GPL-3.0-only"\n}\n';
	expect(await Effect.runPromise(generatedJsr(npm, spaces))).toBe(
		'{\n  "name": "@kjanat/beepboop",\n  "license": "GPL-3.0-only",\n  "version": "0.8.0"\n}\n',
	);
	const current = tabs.replace('0.7.2', '0.8.0');
	expect(await Effect.runPromise(generatedJsr(npm, current))).toBe(current);
});

test('the build refuses a jsr.json that names another package', async () => {
	const exit = await Effect.runPromiseExit(generatedJsr(npm, '{ "name": "@kjanat/other", "version": "0.8.0" }'));
	expect(Exit.isFailure(exit) && String(exit.cause)).toContain('npm and JSR must share a name');
});
