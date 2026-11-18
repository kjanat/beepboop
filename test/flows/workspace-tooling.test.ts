import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { eachDirectory } from '@root/test/support/directories.ts';
import { Cause, Effect, Exit } from 'effect';
import { boundariesCommand, checkBoundaries, describe as describeViolation } from '@/tooling/workspace/boundaries.ts';
import { codeMask, references } from '@/tooling/workspace/modules.ts';
import { move, moveCommand, verify } from '@/tooling/workspace/move.ts';

let root = '';
eachDirectory('beepboop-workspace-', directory => {
	root = directory;
});

const tsconfig = `{
\t"compilerOptions": {
\t\t"paths": {
\t\t\t"@/*": ["./src/*"],
\t\t\t"@root/*": ["./*"]
\t\t},
\t\t"strict": true
\t}
}
`;
const kernelAlias = '"@root/*": ["./*"],\n\t\t\t"@/kernel/*": ["./packages/kernel/src/*"]';
const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];

function git(...args: string[]): string {
	const result = Bun.spawnSync(['git', ...identity, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString();
}

function write(path: string, text: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
}

function repository(files: Record<string, string>): void {
	for (const [path, text] of Object.entries({ 'tsconfig.json': tsconfig, ...files })) write(path, text);
	git('init', '-q');
	git('add', '-A');
	git('commit', '-qm', 'fixture');
}

function read(path: string): string {
	return readFileSync(join(root, path), 'utf8');
}

async function refusal<A>(effect: Effect.Effect<A, unknown>): Promise<string> {
	const exit = await Effect.runPromiseExit(effect);
	return Exit.isFailure(exit) ? Cause.pretty(exit.cause) : 'succeeded';
}

describe('module references', () => {
	test('only imports in code count, never text inside strings, comments, templates or regexes', () => {
		const source = [
			"import a from './a';",
			'const fixture = "import { d } from \'./a\';";',
			"// moved from './a'",
			"/* import './a' */",
			"const pattern = /from '.\\/a'/;",
			"const template = `${import('./b')} import './a'`;",
			"export * from './c';",
			"import d = require('./d');",
			"await import(/* lazy */ './e');",
			"mock.module('./f', () => ({}));",
			"import /* why */ './g';",
			"import { h } from /* why */ './h';",
			"const i = import( // lazy\n './i');",
			"const j = require /* cjs */ ('./j');",
		].join('\n');

		expect(references('x.ts', source).map(reference => reference.specifier)).toEqual([
			'./a',
			'./b',
			'./c',
			'./d',
			'./e',
			'./f',
			'./g',
			'./h',
			'./i',
			'./j',
		]);
	});

	test('a shebang line is neither code nor an import, with or without a following line', () => {
		expect(references('cli.ts', "#!/usr/bin/env bun\nimport { a } from './a';\n").map(r => r.specifier)).toEqual([
			'./a',
		]);
		expect([...codeMask('#!/usr/bin/env bun')]).toEqual(Array.from({ length: 18 }, () => 0));
	});

	test('a division is code and the template expression after it is still scanned', () => {
		const source = "const half = total / 2; const path = `${import('./x')}`;";
		const mask = codeMask(source);

		expect(mask[source.indexOf('2')]).toBe(1);
		expect(references('x.ts', source).map(reference => reference.specifier)).toEqual(['./x']);
	});

	test('postfix operators, keyword-named properties, line-broken identifiers and statement headers keep the lexer in step', () => {
		const prefixes = [
			'const h = i++ / 2 + `/`;',
			'const h = i-- / 2 + `/`;',
			'const b = a\nreturn /`/.test(b);',
			'for (const m of /`/g.exec(s) ?? []) {}',
			'async function f() { return await /`/.exec(s); }',
			'if (x) /`/.test(y);',
			'const n = obj.in / 2 + `/`;',
			'const ratio = value! / 2 + `/`;',
		];

		for (const prefix of prefixes) {
			expect([prefix, references('x.ts', `${prefix}\nimport('./a');\n`).map(r => r.specifier)]).toEqual([prefix, [
				'./a',
			]]);
		}
	});

	test('Astro files contribute frontmatter, inline script imports and script sources', () => {
		const source = [
			'---',
			"import Card from '@/Card.astro';",
			'---',
			"<p>import nothing from './text';</p>",
			'<script src="@/app.ts"></script>',
			"<script>import { run } from './inline.ts';</script>",
		].join('\n');

		expect(references('Page.astro', source).map(reference => reference.specifier)).toEqual([
			'@/Card.astro',
			'@/app.ts',
			'./inline.ts',
		]);
	});
});

describe('move', () => {
	test('a moved module keeps every importer, relative neighbour and tsconfig alias working', async () => {
		repository({
			'src/distinct.ts': "import { other } from './other';\nexport const distinct = other;\n",
			'src/other.ts': 'export const other = 1;\n',
			'src/uses.ts': "import { distinct } from '@/distinct';\nimport type { distinct as D } from '@/distinct.ts';\n",
			'src/nested/near.ts': "export { distinct } from '../distinct.ts';\nconst lazy = import('../distinct');\n",
			'src/Page.astro':
				'---\nimport { distinct } from \'@/distinct.ts\';\n---\n<script src="@/distinct.ts"></script>\n',
			'test/mocked.test.ts': "mock.module('@/distinct.ts', () => ({}));\nimport '@root/src/distinct.ts';\n",
			'docs/notes.md': 'See src/distinct.ts.\n',
			'test/fixtures/copy.ts': "import { distinct } from '@/distinct';\n",
		});
		const report = await Effect.runPromise(
			move(root, [['./src/distinct.ts', './packages/kernel/src/collections/distinct.ts']]),
		);

		expect(report).toEqual({
			moved: 1,
			rewritten: 10,
			files: 6,
			addedAliases: ['@/kernel/*'],
			mentions: ['docs/notes.md:1:See src/distinct.ts.'],
			review: [],
		});
		expect(read('packages/kernel/src/collections/distinct.ts')).toBe(
			"import { other } from '@/other.ts';\nexport const distinct = other;\n",
		);
		expect(read('src/uses.ts')).toBe(
			"import { distinct } from '@/kernel/collections/distinct.ts';\nimport type { distinct as D } from '@/kernel/collections/distinct.ts';\n",
		);
		expect(read('src/nested/near.ts')).toBe(
			"export { distinct } from '@/kernel/collections/distinct.ts';\nconst lazy = import('@/kernel/collections/distinct.ts');\n",
		);
		expect(read('src/Page.astro')).toBe(
			'---\nimport { distinct } from \'@/kernel/collections/distinct.ts\';\n---\n<script src="@/kernel/collections/distinct.ts"></script>\n',
		);
		expect(read('test/mocked.test.ts')).toBe(
			"mock.module('@/kernel/collections/distinct.ts', () => ({}));\nimport '@/kernel/collections/distinct.ts';\n",
		);
		expect(read('test/fixtures/copy.ts')).toBe("import { distinct } from '@/kernel/collections/distinct.ts';\n");
		expect(read('tsconfig.json')).toBe(tsconfig.replace('"@root/*": ["./*"]', kernelAlias));
		expect(git('status', '--short')).toBe(
			'RM src/distinct.ts -> packages/kernel/src/collections/distinct.ts\n M src/Page.astro\n M src/nested/near.ts\n M src/uses.ts\n M test/fixtures/copy.ts\n M test/mocked.test.ts\n M tsconfig.json\n',
		);
	});

	test('a directory moves file by file, keeps its internal relative imports and reuses the alias', async () => {
		repository({
			'tsconfig.json': tsconfig.replace('"@root/*": ["./*"]', kernelAlias),
			'packages/kernel/src/a.ts': 'export const a = 1;\n',
			'src/text/json.ts': "import { a } from '@/kernel/a.ts';\nexport { a };\n",
			'src/text/listing.ts': "export { a } from './json.ts';\n",
			'src/uses.ts': "import { a } from '@/text/listing';\n",
		});
		const report = await Effect.runPromise(move(root, [['src/text/', 'packages/kernel/src/text']]));

		expect(report).toEqual({ moved: 2, rewritten: 1, files: 1, addedAliases: [], mentions: [], review: [] });
		expect(read('tsconfig.json')).toBe(tsconfig.replace('"@root/*": ["./*"]', kernelAlias));
		expect(read('packages/kernel/src/text/json.ts')).toBe("import { a } from '@/kernel/a.ts';\nexport { a };\n");
		expect(read('packages/kernel/src/text/listing.ts')).toBe("export { a } from './json.ts';\n");
		expect(read('src/uses.ts')).toBe("import { a } from '@/kernel/text/listing.ts';\n");
	});

	test('a new package alias that would shadow an unmoved legacy folder falls back to a specifier that still works', async () => {
		repository({
			'src/distinct.ts': 'export const distinct = 1;\n',
			'src/kernel/foo.ts': 'export const f = 1;\n',
			'src/uses.ts': "import { f } from '@/kernel/foo';\nimport { distinct } from '@/distinct';\n",
		});
		await Effect.runPromise(move(root, [['src/distinct.ts', 'packages/kernel/src/distinct.ts']]));

		expect(read('src/uses.ts')).toBe(
			"import { f } from '@root/src/kernel/foo.ts';\nimport { distinct } from '@/kernel/distinct.ts';\n",
		);
	});

	test('JavaScript extensions, query suffixes, require, parent index imports and export star all follow the move', async () => {
		repository({
			'src/lib/index.ts': 'export const lib = 1;\n',
			'src/lib/raw.css': 'a {}\n',
			'src/lib/inner/use.ts': "import { lib } from '..';\nexport * from '../index.js';\n",
			'src/app.ts': "import l = require('./lib');\nimport css from './lib/raw.css?raw';\n",
		});
		await Effect.runPromise(move(root, [['src/lib', 'packages/kernel/src/lib']]));

		expect(read('packages/kernel/src/lib/inner/use.ts')).toBe(
			"import { lib } from '..';\nexport * from '../index.js';\n",
		);
		expect(read('src/app.ts')).toBe(
			"import l = require('@/kernel/lib/index.ts');\nimport css from '@/kernel/lib/raw.css?raw';\n",
		);
	});

	test('an executable script with a shebang has its imports rewritten and verified', async () => {
		repository({
			'src/a.ts': 'export const a = 1;\n',
			'scripts/run.ts': "#!/usr/bin/env bun\nimport { a } from '@/a';\nimport { b } from './b.ts';\n",
			'scripts/b.ts': 'export const b = 1;\n',
		});
		await Effect.runPromise(move(root, [['src/a.ts', 'packages/kernel/src/a.ts']]));

		expect(read('scripts/run.ts')).toBe(
			"#!/usr/bin/env bun\nimport { a } from '@/kernel/a.ts';\nimport { b } from './b.ts';\n",
		);
	});

	test('import.meta paths in moved files and paths that name moved files are rewritten', async () => {
		repository({
			'schemas/v1.json': '{}\n',
			'src/tooling/build.ts': [
				"const root = resolve(import.meta.dir, '../..');",
				"const schema = new URL('../../schemas/v1.json', import.meta.url).pathname;",
				'console.log(import.meta.url);',
			].join('\n'),
			'src/components/Runs.astro': '<p>runs</p>\n',
			'src/components/Overview.astro': '<p>overview</p>\n',
			'test/flows/runs.test.ts': [
				"const runs = join(import.meta.dir, '../../src/components/Runs.astro');",
				'const any = (name: string) => join(import.meta.dir, `../../src/components/${name}.astro`);',
				'const output = `${import.meta.dir}/prepared.json`;',
			].join('\n'),
		});
		const report = await Effect.runPromise(
			move(root, [['src/tooling', 'packages/tooling/src'], ['src/components', 'packages/ui/src/components']]),
		);

		expect(read('packages/tooling/src/build.ts')).toBe([
			"const root = resolve(import.meta.dir, '../../..');",
			"const schema = new URL('../../../schemas/v1.json', import.meta.url).pathname;",
			'console.log(import.meta.url);',
		].join('\n'));
		expect(read('test/flows/runs.test.ts')).toBe([
			"const runs = join(import.meta.dir, '../../packages/ui/src/components/Runs.astro');",
			'const any = (name: string) => join(import.meta.dir, `../../packages/ui/src/components/${name}.astro`);',
			'const output = `${import.meta.dir}/prepared.json`;',
		].join('\n'));
		expect(report.review).toEqual([
			'packages/tooling/src/build.ts:3 uses import.meta in a way the move cannot rewrite',
		]);
	});

	test('a dynamic path into a directory whose files scatter moves the files and asks for a review', async () => {
		repository({
			'src/components/Runs.astro': '<p>runs</p>\n',
			'src/components/Overview.astro': '<p>overview</p>\n',
			'test/flows/runs.test.ts':
				'const any = (name: string) => join(import.meta.dir, `../../src/components/${name}.astro`);\n',
		});
		const report = await Effect.runPromise(move(root, [['src/components/Runs.astro', 'packages/ui/src/Runs.astro']]));

		expect(report.review).toEqual([
			'test/flows/runs.test.ts:1 ../../src/components/ names files that move to different places',
		]);
		expect(read('test/flows/runs.test.ts')).toBe(
			'const any = (name: string) => join(import.meta.dir, `../../src/components/${name}.astro`);\n',
		);
	});

	test('a moved file keeps reaching untracked, generated and out-of-repo paths at their old location', async () => {
		repository({
			'.gitignore': 'dist/\nsrc/tooling/generated.ts\n',
			'src/env.d.ts': 'declare const env: string;\n',
			'src/tooling/build.ts': [
				"import type { Env } from '../env';",
				"import { built } from './generated.ts';",
				"const cli = join(import.meta.dir, '../../dist/cli.js');",
				"const local = new URL('../../wrangler.local.jsonc', import.meta.url);",
				"const sibling = join(import.meta.dir, '../../../sibling-repo/config.ts');",
				'const data = `${import.meta.dir}/../../data/v.json`;',
				"const parts = join(import.meta.dir, '..', '..', 'dist', 'cli.js');",
			].join('\n'),
		});
		const report = await Effect.runPromise(move(root, [['src/tooling', 'packages/tooling/src']]));

		expect(read('packages/tooling/src/build.ts')).toBe([
			"import type { Env } from '@/env';",
			"import { built } from '../../../src/tooling/generated.ts';",
			"const cli = join(import.meta.dir, '../../../dist/cli.js');",
			"const local = new URL('../../../wrangler.local.jsonc', import.meta.url);",
			"const sibling = join(import.meta.dir, '../../../../sibling-repo/config.ts');",
			'const data = `${import.meta.dir}/../../../data/v.json`;',
			"const parts = join(import.meta.dir, '../../../dist/cli.js');",
		].join('\n'));
		expect(report.review).toEqual([]);
	});

	test('a tracked file deleted from the worktree refuses the move before anything changes', async () => {
		repository({
			'src/lib/a.ts': 'export const a = 1;\n',
			'src/lib/data.json': '{}\n',
			'src/use.ts': "import { a } from './lib/a';\n",
		});
		rmSync(join(root, 'src/lib/data.json'));

		expect(await refusal(move(root, [['src/lib', 'packages/kernel/src/lib']]))).toContain(
			'src/lib/data.json is tracked but missing from the worktree',
		);
		expect(git('status', '--short')).toBe(' D src/lib/data.json\n');
		expect(read('tsconfig.json')).toBe(tsconfig);
	});

	test('require.resolve and import.meta.resolve follow the move like imports', async () => {
		repository({
			'src/a.ts': 'export const a = 1;\n',
			'src/lib/use.ts': "const path = require.resolve('../a.ts');\nconst url = import.meta.resolve('../a.ts');\n",
		});
		await Effect.runPromise(move(root, [['src/lib', 'packages/kernel/src/lib']]));

		expect(read('packages/kernel/src/lib/use.ts')).toBe(
			"const path = require.resolve('@/a.ts');\nconst url = import.meta.resolve('@/a.ts');\n",
		);
	});

	test('verification also checks import-shaped text the lexer treats as data', async () => {
		const layout = {
			aliases: [{ pattern: '@/*', targets: ['./src/*'] }],
			files: new Set(['src/a.ts', 'src/b.ts']),
			workspaces: [],
		};
		const moved = { aliases: layout.aliases, files: new Set(['packages/k/src/b.ts', 'src/a.ts']), workspaces: [] };
		const plan = { files: new Map([['src/b.ts', 'packages/k/src/b.ts']]), directories: [] };
		const source = 'const text = "import { a } from \'./a.ts\'";\n';

		expect(await Effect.runPromise(verify('src/b.ts', 'packages/k/src/b.ts', source, source, layout, moved, plan)))
			.toEqual(['src/b.ts: the move would break ./a.ts']);
	});

	test('a missing source, a repeated or occupied target, an untracked file in the way and a file parent each refuse before anything moves', async () => {
		repository({
			'src/a.ts': 'export const a = 1;\n',
			'src/b.ts': 'export const b = 1;\n',
			'src/c.ts': "import './a';\n",
		});
		write('packages/k/src/b.ts', 'leftover\n');
		write('packages/file', 'not a directory\n');

		expect(await refusal(move(root, [['src/nope.ts', 'packages/kernel/src/nope.ts']]))).toContain(
			'Not a tracked file or directory: src/nope.ts',
		);
		expect(await refusal(move(root, [['src/a.ts', 'src/b.ts']]))).toContain(
			'Move target already exists or repeats: src/b.ts',
		);
		expect(await refusal(move(root, [['src/a.ts', 'packages/x.ts'], ['src/b.ts', 'packages/x.ts']]))).toContain(
			'Move target already exists or repeats: packages/x.ts',
		);
		const blocked = await refusal(move(root, [
			['src/a.ts', 'packages/k/src/a.ts'],
			['src/b.ts', 'packages/k/src/b.ts'],
			['src/c.ts', 'packages/file/c.ts'],
		]));
		expect(blocked).toContain('packages/k/src/b.ts already exists on disk');
		expect(blocked).toContain('packages/file/c.ts would sit under the file packages/file');
		expect(git('status', '--short')).toBe('?? packages/\n');
		expect(read('src/c.ts')).toBe("import './a';\n");
	});

	test('a tsconfig without paths entries refuses to take a package alias', async () => {
		repository({
			'tsconfig.json': '{ "compilerOptions": { "paths": {} } }\n',
			'src/a.ts': 'export const a = 1;\n',
		});

		expect(await refusal(move(root, [['src/a.ts', 'packages/kernel/src/a.ts']]))).toContain(
			'tsconfig.json has no compilerOptions.paths entries',
		);
		expect(git('status', '--short')).toBe('');
	});

	test('absolute URLs and absolute resolve arguments stay untouched when their file moves', async () => {
		repository({
			'src/lib/use.ts': [
				"const api = new URL('https://example.invalid/x', import.meta.url);",
				"const root = new URL('/etc/hosts', import.meta.url);",
				"const hosts = resolve(import.meta.dir, '/etc/hosts');",
			].join('\n'),
		});
		await Effect.runPromise(move(root, [['src/lib', 'packages/kernel/src/lib']]));

		expect(read('packages/kernel/src/lib/use.ts')).toBe([
			"const api = new URL('https://example.invalid/x', import.meta.url);",
			"const root = new URL('/etc/hosts', import.meta.url);",
			"const hosts = resolve(import.meta.dir, '/etc/hosts');",
		].join('\n'));
	});

	test('a target under another planned file target, an alias name already taken and a target outside the repository refuse', async () => {
		repository({
			'tsconfig.json': tsconfig.replace(
				'"@root/*": ["./*"]',
				'"@root/*": ["./*"],\n\t\t\t"@/kernel/*": ["./src/kernel/*"]',
			),
			'src/a.ts': 'export const a = 1;\n',
			'src/b.ts': 'export const b = 1;\n',
		});

		expect(await refusal(move(root, [['src/a.ts', 'out/file'], ['src/b.ts', 'out/file/b.ts']]))).toContain(
			'out/file/b.ts would sit under the planned file out/file',
		);
		expect(await refusal(move(root, [['src/a.ts', 'packages/kernel/src/a.ts']]))).toContain(
			'tsconfig.json already maps @/kernel/* to ./src/kernel/*',
		);
		expect(await refusal(move(root, [['src/a.ts', '../elsewhere/a.ts']]))).toContain(
			'Move target leaves the repository: ../elsewhere/a.ts',
		);
		expect(git('status', '--short')).toBe('');
	});

	test('a directory moved to the repository root lands at the root', async () => {
		repository({ 'src/lib/a.ts': 'export const a = 1;\n', 'src/use.ts': "import { a } from './lib/a.ts';\n" });
		await Effect.runPromise(move(root, [['src/lib', '.']]));

		expect(read('a.ts')).toBe('export const a = 1;\n');
		expect(read('src/use.ts')).toBe("import { a } from '@root/a.ts';\n");
	});

	test('an extensionless import of a JavaScript file follows its move', async () => {
		repository({ 'src/a.js': 'export const a = 1;\n', 'src/use.ts': "import { a } from './a';\n" });
		await Effect.runPromise(move(root, [['src/a.js', 'packages/kernel/src/a.js']]));

		expect(read('src/use.ts')).toBe("import { a } from '@/kernel/a.js';\n");
	});

	test('a directory move with a per-file override asks for a review of dynamic paths into it', async () => {
		repository({
			'src/widgets/a.ts': 'export const a = 1;\n',
			'src/widgets/b.ts': 'export const b = 1;\n',
			'test/load.ts': 'const load = (name: string) => import(join(import.meta.dir, `../src/widgets/${name}.ts`));\n',
		});
		const report = await Effect.runPromise(move(root, [
			['src/widgets', 'packages/kernel/src/widgets'],
			['src/widgets/b.ts', 'packages/ui/src/b.ts'],
		]));

		expect(report.review).toEqual(['test/load.ts:1 ../src/widgets/ names files that move to different places']);
	});

	test('TSX importers, URL queries and workspace package imports follow a move', async () => {
		repository({
			'packages/kernel/package.json': '{ "name": "@beepboop/kernel", "exports": { "./*": "./src/*" } }',
			'packages/kernel/src/a.ts': 'export const a = 1;\n',
			'src/data.json': '{}\n',
			'src/view.tsx':
				"import { a } from '@beepboop/kernel/a.ts';\nconst raw = new URL('./data.json?raw#part', import.meta.url);\n",
		});
		await Effect.runPromise(move(root, [
			['packages/kernel/src/a.ts', 'packages/kernel/src/b.ts'],
			['src/data.json', 'src/assets/data.json'],
		]));

		expect(read('src/view.tsx')).toBe(
			"import { a } from '@beepboop/kernel/b.ts';\nconst raw = new URL('./assets/data.json?raw#part', import.meta.url);\n",
		);
	});

	test('a workspace package import whose file leaves the package exports refuses the move', async () => {
		repository({
			'packages/kernel/package.json': '{ "name": "@beepboop/kernel", "exports": { "./*": "./src/*" } }',
			'packages/kernel/src/a.ts': 'export const a = 1;\n',
			'src/use.ts': "import { a } from '@beepboop/kernel/a.ts';\n",
		});

		expect(await refusal(move(root, [['packages/kernel/src/a.ts', 'packages/kernel/lib/a.ts']]))).toContain(
			'src/use.ts: no specifier reaches packages/kernel/lib/a.ts from src/use.ts',
		);
		expect(git('status', '--short')).toBe('');
	});

	test('self-referencing URLs stay put and percent-encoded URL paths follow their file', async () => {
		repository({
			'src/other.ts': 'export const other = 1;\n',
			'src/data file.json': '{}\n',
			'src/a.ts': [
				"const raw = new URL('?raw', import.meta.url);",
				"const part = new URL('#part', import.meta.url);",
				"const data = new URL('./data%20file.json', import.meta.url);",
			].join('\n'),
		});
		await Effect.runPromise(move(root, [
			['src/a.ts', 'packages/kernel/src/a.ts'],
			['src/data file.json', 'src/assets/data file.json'],
		]));

		expect(read('packages/kernel/src/a.ts')).toBe([
			"const raw = new URL('?raw', import.meta.url);",
			"const part = new URL('#part', import.meta.url);",
			"const data = new URL('../../../src/assets/data%20file.json', import.meta.url);",
		].join('\n'));
	});

	test('import and require references follow the export condition they resolve through', async () => {
		repository({
			'packages/kernel/package.json': JSON.stringify({
				name: '@beepboop/kernel',
				exports: { './*': { import: './src/esm/*.ts', require: './src/cjs/*.ts' } },
			}),
			'packages/kernel/src/esm/a.ts': 'export const a = 1;\n',
			'packages/kernel/src/cjs/a.ts': 'exports.a = 1;\n',
			'src/use.ts': "import { a } from '@beepboop/kernel/a';\nconst b = require('@beepboop/kernel/a');\n",
		});
		await Effect.runPromise(move(root, [['packages/kernel/src/esm/a.ts', 'packages/kernel/src/esm/b.ts']]));

		expect(read('src/use.ts')).toBe(
			"import { a } from '@beepboop/kernel/b';\nconst b = require('@beepboop/kernel/a');\n",
		);
	});

	test('the command takes pairs, reports what still mentions the old path, and refuses an odd argument list', async () => {
		repository({
			'src/a.ts': 'export const a = 1;\n',
			'README.md': 'Edit src/a.ts.\n',
			'docs/other.md': 'See packages/x/src/a.ts and lib/src/a.ts.\n',
		});

		expect(await refusal(moveCommand(root, ['src/a.ts']))).toContain('Usage: move <from> <to> [<from> <to>...]');
		expect(await refusal(moveCommand(root, []))).toContain('Usage: move <from> <to> [<from> <to>...]');
		expect(await Effect.runPromise(moveCommand(root, ['src/a.ts', 'packages/kernel/src/a.ts']))).toBe([
			'Moved 1 files; rewrote 0 references in 0 files',
			'Added tsconfig path @/kernel/*',
			'Still mentions the old path: README.md:1:Edit src/a.ts.',
		].join('\n'));
	});

	test('the move script runs as a process in the current repository', () => {
		repository({ 'src/a.ts': 'export const a = 1;\n' });
		const script = resolve(import.meta.dir, '../../src/tooling/workspace/move.ts');
		const moved = Bun.spawnSync(['bun', script, 'src/a.ts', 'packages/kernel/src/a.ts'], { cwd: root, stdout: 'pipe' });
		const failed = Bun.spawnSync(['bun', script, 'src/a.ts'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

		expect([moved.exitCode, moved.stdout.toString()]).toEqual([
			0,
			'Moved 1 files; rewrote 0 references in 0 files\nAdded tsconfig path @/kernel/*\n',
		]);
		expect(failed.exitCode).toBe(1);
		expect(failed.stderr.toString()).toContain('Usage: move <from> <to>');
	});
});

describe('boundaries', () => {
	const aliases = tsconfig.replace(
		'"@root/*": ["./*"]',
		`${kernelAlias},\n\t\t\t"@/domain/*": ["./packages/domain/src/*"]`,
	);

	test('declared package and npm edges, own-package imports, builtins, root assets and declared build output pass', async () => {
		repository({
			'tsconfig.json': aliases,
			'schemas/v1.json': '{}\n',
			'packages/kernel/package.json':
				'{ "name": "@beepboop/kernel", "files": ["built.js"], "exports": { "./*": "./src/*" }, "dependencies": { "effect": "4", "yaml": "2" } }',
			'packages/kernel/src/a.ts':
				"import { Effect } from 'effect';\nimport { b } from './b.ts';\nimport { c } from '@/kernel/b.ts';\nimport { join } from 'node:path';\nimport { readFileSync } from 'fs';\nimport { mock } from 'bun:test';\nimport raw from 'yaml?raw';\nimport schema from '@root/schemas/v1.json';\n",
			'packages/kernel/src/b.ts': 'export const b = 1;\n',
			'packages/kernel/mod.ts': "export * from './built.js';\n",
			'packages/domain/package.json':
				'{ "name": "@beepboop/domain", "devDependencies": { "@beepboop/kernel": "workspace:*" } }',
			'packages/domain/src/c.ts': "import { b } from '@/kernel/b.ts';\nexport * from '@beepboop/kernel/b.ts';\n",
			'src/legacy.ts': "import { b } from '@/kernel/b.ts';\n",
		});
		const report = await Effect.runPromise(checkBoundaries(root));

		expect(report).toEqual({ files: 4, packages: 2, violations: [] });
		expect(await Effect.runPromise(boundariesCommand(root))).toBe('Checked 4 files in 2 packages');
	});

	test('legacy imports, escapes, undeclared edges, unresolved specifiers, cycles and a second effect copy are each reported', async () => {
		repository({
			'tsconfig.json': aliases.replace(
				'"@/domain/*": ["./packages/domain/src/*"]',
				'"@/domain/*": ["./packages/domain/src/*"],\n\t\t\t"@/cli/*": ["./packages/cli/src/*"]',
			),
			'packages/kernel/package.json':
				'{ "name": "@beepboop/kernel", "exports": { "./*": "./src/*" }, "dependencies": { "@beepboop/domain": "workspace:*" } }',
			'packages/kernel/src/a.ts':
				"import { legacy } from '@/legacy.ts';\nconst c = await import('@/domain/c.ts');\nimport l = require('../../../src/legacy');\nimport 'jsonc-parser';\nimport { gone } from '@/kernel/gone.ts';\n",
			'packages/domain/package.json':
				'{ "name": "@beepboop/domain", "dependencies": { "@beepboop/cli": "workspace:*" } }',
			'packages/domain/src/c.ts': "export { a } from '@/kernel/a.ts';\nimport '@/cli/d.ts';\n",
			'packages/cli/package.json': '{ "name": "@beepboop/cli", "dependencies": { "@beepboop/kernel": "workspace:*" } }',
			'packages/cli/src/d.ts': "import '@beepboop/kernel/a.ts';\nimport '@beepboop/kernel/nope.ts';\n",
			'src/legacy.ts': 'export const legacy = 1;\n',
		});
		write('packages/domain/node_modules/effect/package.json', '{}');
		const report = await Effect.runPromise(checkBoundaries(root));

		expect(report.violations.map(describeViolation)).toEqual([
			'packages/cli/src/d.ts imports @beepboop/kernel/nope.ts, which resolves to no tracked file',
			'packages/domain/src/c.ts imports @/kernel/a.ts without declaring @beepboop/kernel',
			'packages/kernel/src/a.ts imports @/legacy.ts, which resolves outside any package (src/legacy.ts)',
			'packages/kernel/src/a.ts imports ../../../src/legacy, which resolves outside any package (src/legacy.ts)',
			'packages/kernel/src/a.ts imports jsonc-parser without declaring jsonc-parser',
			'packages/kernel/src/a.ts imports @/kernel/gone.ts, which resolves to no tracked file',
			'Package cycle: @beepboop/kernel -> @beepboop/domain -> @beepboop/kernel',
			'Package cycle: @beepboop/cli -> @beepboop/kernel -> @beepboop/domain -> @beepboop/cli',
			'A second copy of effect is installed at packages/domain/node_modules/effect/package.json',
		]);
		expect(await refusal(boundariesCommand(root))).toContain('9 package boundary violations');
	});

	test('exports resolve exact keys first, then the most specific pattern, through conditions and every wildcard', async () => {
		repository({
			'packages/kernel/package.json': JSON.stringify({
				name: '@beepboop/kernel',
				exports: {
					'.': { types: './src/index.d.ts', import: './src/index.ts' },
					'./*': './src/*.ts',
					'./ui/*': './src/ui/*/*.ts',
					'./feature': './missing.ts',
				},
			}),
			'packages/kernel/src/index.ts': 'export const index = 1;\n',
			'packages/kernel/src/feature.ts': 'export const feature = 1;\n',
			'packages/kernel/src/ui/button/button.ts': 'export const button = 1;\n',
			'packages/domain/package.json':
				'{ "name": "@beepboop/domain", "dependencies": { "@beepboop/kernel": "workspace:*" } }',
			'packages/domain/src/view.tsx': "import '@/legacy.ts';\n",
			'packages/domain/src/c.ts': [
				"import '@beepboop/kernel';",
				"import '@beepboop/kernel/ui/button';",
				"import '@beepboop/kernel/feature';",
				'await import(`@/legacy.ts`);',
			].join('\n'),
			'src/legacy.ts': 'export const legacy = 1;\n',
		});
		const report = await Effect.runPromise(checkBoundaries(root));

		expect(report.violations.map(describeViolation)).toEqual([
			'packages/domain/src/c.ts imports @beepboop/kernel/feature, which resolves to no tracked file',
			'packages/domain/src/c.ts imports @/legacy.ts, which resolves outside any package (src/legacy.ts)',
			'packages/domain/src/view.tsx imports @/legacy.ts, which resolves outside any package (src/legacy.ts)',
		]);
	});

	test('the boundaries script exits non-zero on violations', () => {
		repository({
			'packages/kernel/package.json': '{ "name": "@beepboop/kernel" }',
			'packages/kernel/src/a.ts': "import 'yaml';\n",
		});
		const script = resolve(import.meta.dir, '../../src/tooling/workspace/boundaries.ts');
		const result = Bun.spawnSync(['bun', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain('packages/kernel/src/a.ts imports yaml without declaring yaml');
	});

	test('a manifest without a name is rejected', async () => {
		repository({ 'packages/kernel/package.json': '{}', 'packages/kernel/src/a.ts': '' });

		expect(await refusal(checkBoundaries(root))).toContain('name');
	});
});
