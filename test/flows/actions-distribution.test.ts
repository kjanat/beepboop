import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, gitOutput, materialize } from '@root/test/support/actions.ts';
import { Effect, Exit } from 'effect';
import { publishDistribution } from '@/tooling/actions/distribute';
import { releaseLevel } from '@/tooling/actions/release';

const begin = [
	'name: Begin',
	'inputs:',
	'  stream:',
	'    default: main',
	'runs:',
	'  using: composite',
	'  steps:',
	'    - uses: $/actions/deps/bun',
	'    - uses: $/actions/token',
	'',
].join('\n');
const token = 'runs:\n  using: composite\n  steps:\n    - uses: $/actions/deps/bun\n';
const untouched = {
	'actions/deps/bun/action.yml': 'runs:\n  using: composite\n  steps: []\n',
	'actions/publish-refs/README.md': 'The source tree names $/packages/actions/actions/token.\n',
	'actions/token/my-action.yml': 'uses: $/packages/actions/actions/deps/bun\n',
};
const moving = (text: string) => text.replaceAll('$/actions/', '$/packages/actions/actions/');
const bundled = {
	'client.ts': 'console.log("client");\n',
	'generate-winget.ts': '#!/usr/bin/env bun\nconsole.log(1);\n',
};

function publishedTree(dir: string, commit: string): string {
	return gitOutput(dir, ['ls-tree', '-r', '--format=%(objectmode) %(path)', commit]);
}

test('distribution reproduces the published actions tree from packages/actions and moves it on change', async () => {
	const remote = mkdtempSync(join(tmpdir(), 'beepboop-actions-remote-'));
	const bundles = mkdtempSync(join(tmpdir(), 'beepboop-actions-bundles-'));
	const { dir } = materialize({
		'actions/begin/action.yml': begin,
		'actions/token/action.yaml': token,
		...untouched,
		'README.md': 'one\n',
	});
	try {
		chmodSync(join(dir, 'actions/token/action.yaml'), 0o755);
		const legacySource = commitAll(dir, 'Make the token manifest executable');
		gitOutput(remote, ['init', '--bare', '-q']);
		gitOutput(dir, ['remote', 'add', 'origin', remote]);
		for (const [name, content] of Object.entries(bundled)) {
			writeFileSync(join(bundles, name), content);
			const blob = gitOutput(dir, ['hash-object', '-w', join(bundles, name)]);
			const mode = content.startsWith('#!') ? '100755' : '100644';
			gitOutput(dir, ['update-index', '--add', '--cacheinfo', `${mode},${blob},actions/runtime/${name}`]);
		}
		const legacyTree = gitOutput(dir, ['write-tree']);
		gitOutput(dir, ['read-tree', 'HEAD']);
		const legacy = gitOutput(dir, ['commit-tree', legacyTree, '-p', legacySource, '-m', 'Publish Actions']);
		gitOutput(dir, ['push', '-q', 'origin', `${legacy}:refs/heads/actions`]);

		mkdirSync(join(dir, 'packages/actions'), { recursive: true });
		gitOutput(dir, ['mv', 'actions', 'packages/actions/actions']);
		writeFileSync(join(dir, 'packages/actions/actions/begin/action.yml'), moving(begin));
		writeFileSync(join(dir, 'packages/actions/actions/token/action.yaml'), moving(token));
		const moved = commitAll(dir, 'Move actions into packages/actions');
		expect(await Effect.runPromise(publishDistribution(dir, moved, bundles))).toEqual({
			_tag: 'Unchanged',
			commit: legacy,
		});

		const versioned = begin.replace('inputs:\n', 'inputs:\n  version:\n    default: ""\n');
		writeFileSync(join(dir, 'packages/actions/actions/begin/action.yml'), moving(versioned));
		const changed = commitAll(dir, 'Add a version input');
		const published = await Effect.runPromise(publishDistribution(dir, changed, bundles));
		expect(published._tag).toBe('Published');
		expect(gitOutput(dir, ['ls-remote', 'origin', 'refs/heads/actions'])).toStartWith(published.commit);
		expect(gitOutput(dir, ['rev-list', '--parents', '-n', '1', published.commit]).split(' ')).toEqual([
			published.commit,
			changed,
			legacy,
		]);
		expect(publishedTree(dir, published.commit).split('\n')).toEqual([
			'100644 README.md',
			'100644 actions/begin/action.yml',
			'100644 actions/deps/bun/action.yml',
			'100644 actions/publish-refs/README.md',
			'100644 actions/runtime/client.ts',
			'100755 actions/runtime/generate-winget.ts',
			'100755 actions/token/action.yaml',
			'100644 actions/token/my-action.yml',
			'100644 packages/actions/actions/begin/action.yml',
			'100644 packages/actions/actions/deps/bun/action.yml',
			'100644 packages/actions/actions/publish-refs/README.md',
			'100755 packages/actions/actions/token/action.yaml',
			'100644 packages/actions/actions/token/my-action.yml',
		]);
		for (const [path, content] of Object.entries({ ...untouched, 'actions/token/action.yaml': token })) {
			expect(gitOutput(dir, ['show', `${published.commit}:${path}`])).toBe(content.trimEnd());
		}
		expect(gitOutput(dir, ['cat-file', '-s', `${published.commit}:actions/begin/action.yml`])).toBe(
			String(versioned.length),
		);
		expect(gitOutput(dir, ['show', `${published.commit}:actions/begin/action.yml`])).toBe(versioned.trimEnd());
		expect(await Effect.runPromise(releaseLevel(dir, legacy, published.commit))).toBe('minor');

		const stale = await Effect.runPromiseExit(publishDistribution(dir, moved, bundles));
		expect(Exit.isFailure(stale) && String(stale.cause)).toContain(`which is not an ancestor of ${moved}`);
	} finally {
		for (const path of [remote, bundles, dir]) rmSync(path, { recursive: true, force: true });
	}
});

test('the publish step bundles the runtime, pushes the first distribution and reports it', async () => {
	const remote = mkdtempSync(join(tmpdir(), 'beepboop-actions-remote-'));
	const reports = mkdtempSync(join(tmpdir(), 'beepboop-actions-reports-'));
	const { dir, sha } = materialize({ 'packages/actions/actions/begin/action.yml': begin, 'README.md': 'one\n' });
	const output = join(reports, 'output'), summary = join(reports, 'summary');
	const environment = {
		GITHUB_SHA: sha,
		GITHUB_OUTPUT: output,
		GITHUB_STEP_SUMMARY: summary,
		GITHUB_SERVER_URL: 'https://github.com',
		GITHUB_REPOSITORY: 'octo/widget',
	};
	const distribute = async (variables: Record<string, string>) => {
		const child = Bun.spawn(['bun', join(import.meta.dir, '../../src/tooling/actions/distribute.ts')], {
			cwd: dir,
			env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? dir, ...variables },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { code, output: stdout + stderr };
	};
	const link = (commit: string) => `[\`${commit}\`](https://github.com/octo/widget/commit/${commit})`;
	try {
		gitOutput(remote, ['init', '--bare', '-q']);
		gitOutput(dir, ['remote', 'add', 'origin', remote]);
		for (const file of [output, summary]) writeFileSync(file, '');

		const invalid = await distribute({ ...environment, GITHUB_SHA: 'main' });
		expect(invalid.code).toBe(1);
		expect(invalid.output).toContain('GITHUB_SHA');

		writeFileSync(join(dir, 'README.md'), 'edited\n');
		expect(await distribute(environment)).toEqual({ code: 1, output: `The checkout differs from ${sha}\n` });
		writeFileSync(join(dir, 'README.md'), 'one\n');

		expect((await distribute(environment)).code).toBe(0);
		const commit = gitOutput(dir, ['ls-remote', 'origin', 'refs/heads/actions']).split('\t')[0] ?? '';
		expect(gitOutput(dir, ['rev-list', '--parents', '-n', '1', commit])).toBe(`${commit} ${sha}`);
		expect(publishedTree(dir, `${commit}:actions`).split('\n')).toEqual([
			'100644 begin/action.yml',
			'100644 runtime/client.ts',
			'100755 runtime/generate-homebrew.ts',
			'100755 runtime/generate-scoop.ts',
			'100755 runtime/generate-winget.ts',
			'100644 runtime/prepare.ts',
			'100644 runtime/publish.ts',
			'100644 runtime/pull-request.ts',
			'100644 runtime/refs.ts',
			'100644 runtime/upload-release-assets.ts',
		]);
		expect(await Bun.file(output).text()).toMatch(new RegExp(`^commit<<(value_[0-9a-f-]+)\\n${commit}\\n\\1\\n$`));
		expect(await Bun.file(summary).text()).toBe(
			`Source commit: ${link(sha)}\nPublished Actions commit: ${link(commit)}\n`,
		);

		writeFileSync(summary, '');
		expect((await distribute(environment)).code).toBe(0);
		expect(await Bun.file(summary).text()).toBe(`Actions are unchanged since ${link(commit)}.\n`);
	} finally {
		for (const path of [remote, reports, dir]) rmSync(path, { recursive: true, force: true });
	}
});
