import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullRequest } from '@root/actions/runtime/pull-request.ts';
import { gitOutput, materialize, runRuntime } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId, filesAt } from '@root/test/support/github.ts';
import { one } from '@root/test/support/lists.ts';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import { githubApiVersion } from '@/contract/http';

let world: World;
const directories: string[] = [];
eachWorld(created => {
	world = created;
});
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const treeBody = z.object({
	tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha: z.string().nullable() })),
});

function checkedOut() {
	const repository = widget(world.github);
	const head = world.github.head(repository);
	const checkout = materialize(filesAt(repository, head));
	directories.push(checkout.dir);
	world.github.relabel(repository, head, checkout.sha);
	const trees: z.output<typeof treeBody>['tree'][] = [];
	const requests: string[] = [];
	const versions = new Set<string | null>();
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		requests.push(`${request.method} ${path.replace('/repos/octo/widget', '')}`);
		versions.add(request.headers.get('x-github-api-version'));
		if (request.method === 'POST' && path.endsWith('/git/trees')) {
			trees.push(treeBody.parse(await request.clone().json()).tree);
		}
		return world.github.handle(request);
	});
	return { repository, checkout, trees, requests, versions };
}

function open(repository: Repository, dir: string, inputs: Record<string, string> = {}) {
	return Effect.runPromise(pullRequest({
		GITHUB_WORKSPACE: dir,
		GITHUB_REPOSITORY: repository.name,
		PR_TOKEN: 'installation-token',
		PR_BRANCH: 'autofix/format',
		PR_TITLE: 'style: apply formatting',
		PR_BODY: 'Formatting drift.',
		...inputs,
	}));
}

test('changes in the checkout become one verified commit and a pull request', async () => {
	const { repository, checkout, trees, versions } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	writeFileSync(join(checkout.dir, 'run.sh'), '#!/bin/sh\necho run\n');
	chmodSync(join(checkout.dir, 'run.sh'), 0o755);
	rmSync(join(checkout.dir, 'LICENSE'));

	const result = await open(repository, checkout.dir);
	const pull = one(repository.pulls, 'pull request');
	expect(result).toEqual({
		operation: 'created',
		number: pull.number,
		url: `https://github.com/octo/widget/pull/${pull.number}`,
		headSha: pull.head.sha,
	});
	expect([pull.head.ref, pull.base, pull.title, pull.body]).toEqual([
		'autofix/format',
		'main',
		'style: apply formatting',
		'Formatting drift.',
	]);
	const commit = world.github.resolve(repository, pull.head.sha);
	expect(commit).toMatchObject({
		parents: [checkout.sha],
		message: 'style: apply formatting',
		verified: true,
		authorId: botId,
	});
	const files = filesAt(repository, pull.head.sha);
	expect(files['README.md']).toBe('# widget\n\nFormatted.\n');
	expect(files['run.sh']).toBe('#!/bin/sh\necho run\n');
	expect(files.LICENSE).toBeUndefined();
	expect(files['package.json']).toBe(readFileSync(join(checkout.dir, 'package.json'), 'utf8'));
	expect(one(trees, 'tree request').map(entry => [entry.path, entry.mode, entry.sha === null]).sort()).toEqual([
		['LICENSE', '100644', true],
		['README.md', '100644', false],
		['run.sh', '100755', false],
	]);
	expect(world.github.head(repository)).toBe(checkout.sha);
	expect([...versions]).toEqual([githubApiVersion]);
});

test('a rerun pushes nothing for the same changes and replaces the commit for new ones', async () => {
	const { repository, checkout, requests } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	const created = await open(repository, checkout.dir);

	requests.length = 0;
	const same = await open(repository, checkout.dir);
	expect(same).toEqual({ ...created, operation: 'none' });
	expect(requests.filter(request => /^(POST|PATCH) \/(git\/(commits|refs)|pulls)/.test(request))).toEqual([]);

	const retitled = await open(repository, checkout.dir, { PR_TITLE: 'style: format', PR_BODY: '' });
	expect(retitled).toEqual({ ...created, operation: 'updated' });
	expect([repository.pulls[0]?.title, repository.pulls[0]?.body]).toEqual(['style: format', '']);

	writeFileSync(join(checkout.dir, 'NOTES.md'), 'More drift\n');
	const updated = await open(repository, checkout.dir, {
		PR_TITLE: 'style: format',
		PR_BODY: '',
		PR_COMMIT_MESSAGE: 'style: format again',
	});
	expect(updated.operation).toBe('updated');
	expect(updated.headSha).not.toBe(created.headSha);
	expect(repository.pulls).toHaveLength(1);
	expect(repository.pulls[0]?.head.sha).toBe(updated.headSha);
	expect(world.github.resolve(repository, updated.headSha ?? '')).toMatchObject({
		parents: [checkout.sha],
		message: 'style: format again',
	});
	expect(Object.keys(filesAt(repository, updated.headSha ?? ''))).toContain('NOTES.md');
});

test('add-paths limits the commit and base names the target branch', async () => {
	const { repository, checkout, trees } = checkedOut();
	repository.refs.set('heads/next', checkout.sha);
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	writeFileSync(join(checkout.dir, 'scratch.txt'), 'local\n');
	gitOutput(checkout.dir, ['checkout', '--detach']);
	await expect(open(repository, checkout.dir)).rejects.toThrow('The checkout is on no branch. Set the base input.');
	const result = await open(repository, checkout.dir, { PR_BASE: 'next', PR_ADD_PATHS: 'README.md\n' });
	expect(result.operation).toBe('created');
	expect(repository.pulls[0]?.base).toBe('next');
	expect(one(trees, 'tree request').map(entry => entry.path)).toEqual(['README.md']);
});

test('a clean checkout opens no pull request and a branch cannot target itself', async () => {
	const { repository, checkout, requests } = checkedOut();
	expect(await open(repository, checkout.dir)).toEqual({ operation: 'none' });
	expect(requests).toEqual([]);
	expect(repository.pulls).toEqual([]);
	await expect(open(repository, checkout.dir, { PR_BRANCH: 'main' })).rejects.toThrow(
		'The pull request branch main is its own base',
	);
});

test('a GitHub refusal fails the step with the status and route', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	repository.protectedBranches.add('autofix/format');
	repository.refs.set('heads/autofix/format', checkout.sha);
	await expect(open(repository, checkout.dir)).rejects.toThrow(
		'GitHub HTTP 422 on PATCH /repos/octo/widget/git/refs/heads/autofix/format',
	);
});

test('the bundled entrypoint writes the step outputs', async () => {
	const { checkout } = checkedOut();
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-pull-request-'));
	directories.push(scratch);
	const output = join(scratch, 'output');
	writeFileSync(output, '');
	await runRuntime('pull-request', {
		GITHUB_WORKSPACE: checkout.dir,
		GITHUB_REPOSITORY: 'octo/widget',
		GITHUB_OUTPUT: output,
		PR_BRANCH: 'autofix/format',
		PR_TITLE: 'style: apply formatting',
		PR_TOKEN: 'installation-token',
	});
	const written = readFileSync(output, 'utf8');
	expect(written).toMatch(/^pull-request-operation<<(value_[0-9a-f-]+)\nnone\n\1$/m);
	expect(written).toMatch(/^pull-request-number<<(value_[0-9a-f-]+)\n\n\1$/m);
});

test('add-paths leaves out a file an earlier step staged', async () => {
	const { repository, checkout, trees } = checkedOut();
	writeFileSync(join(checkout.dir, 'selected.txt'), 'selected\n');
	writeFileSync(join(checkout.dir, 'excluded.txt'), 'excluded\n');
	gitOutput(checkout.dir, ['add', 'excluded.txt']);
	await open(repository, checkout.dir, { PR_ADD_PATHS: 'selected.txt' });
	expect(one(trees, 'tree request').map(entry => entry.path)).toEqual(['selected.txt']);
});

test('a file name with pathspec characters keeps its own contents', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'file1.txt'), 'plain\n');
	writeFileSync(join(checkout.dir, 'file[1].txt'), 'bracketed\n');
	const result = await open(repository, checkout.dir);
	const files = filesAt(repository, result.headSha ?? '');
	expect([files['file1.txt'], files['file[1].txt']]).toEqual(['plain\n', 'bracketed\n']);
});

test('a branch name that needs URL encoding is created under its own name', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	const result = await open(repository, checkout.dir, { PR_BRANCH: 'autofix/café' });
	expect(result.operation).toBe('created');
	expect(repository.refs.get('heads/autofix/café')).toBe(result.headSha);
	expect(repository.pulls[0]?.head.ref).toBe('autofix/café');
	expect((await open(repository, checkout.dir, { PR_BRANCH: 'autofix/café' })).operation).toBe('none');
});
