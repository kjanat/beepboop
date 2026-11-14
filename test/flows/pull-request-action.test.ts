import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
import { Effect, Schema, Struct } from 'effect';
import { githubApiVersion } from '@/contract/http';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';

let world: World;
const directories: string[] = [];
eachWorld(created => {
	world = created;
});
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const treeBody = mutableStruct({
	tree: mutableArray(
		mutableStruct({ path: Schema.String, mode: Schema.String, type: Schema.String, sha: Schema.NullOr(Schema.String) }),
	),
});

function checkedOut() {
	const repository = widget(world.github);
	const head = world.github.head(repository);
	const checkout = materialize(filesAt(repository, head));
	directories.push(checkout.dir);
	world.github.relabel(repository, head, checkout.sha);
	const trees: Decoded<typeof treeBody>['tree'][] = [];
	const requests: string[] = [];
	const versions = new Set<string | null>();
	world.network.serve('api.github.com', async request => {
		const path = new URL(request.url).pathname;
		requests.push(`${request.method} ${path.replace('/repos/octo/widget', '')}`);
		versions.add(request.headers.get('x-github-api-version'));
		if (request.method === 'POST' && path.endsWith('/git/trees')) {
			trees.push(decodeSync(treeBody, await request.clone().json()).tree);
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
		message: 'style: apply formatting\n\nBeepboop-Pull-Request: octo/widget autofix/format main',
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
	expect(requests.filter(request => /^(POST|PATCH) /.test(request))).toEqual([]);

	const retitled = await open(repository, checkout.dir, { PR_TITLE: 'style: format', PR_BODY: '' });
	expect(retitled).toMatchObject({ number: created.number, operation: 'updated' });
	expect(retitled.headSha).not.toBe(created.headSha);
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
		message: 'style: format again\n\nBeepboop-Pull-Request: octo/widget autofix/format main',
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
	await expect(open(repository, checkout.dir, {
		GITHUB_REF: 'refs/pull/7/merge',
		GITHUB_REF_TYPE: 'branch',
		GITHUB_REF_NAME: '7/merge',
	})).rejects.toThrow('The checkout is on no branch. Set the base input.');
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
	await expect(open(repository, checkout.dir, { PR_ALLOW_EXISTING_BRANCH: 'true' })).rejects.toThrow(
		'Protected branch',
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

test('a detached checkout of a pushed branch targets that branch', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	gitOutput(checkout.dir, ['checkout', '--detach']);
	await open(repository, checkout.dir, { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' });
	expect(repository.pulls.map(pull => [pull.head.ref, pull.base])).toEqual([['autofix/format', 'main']]);
});

test('the merge commit of a pull request run is refused, also with a base', async () => {
	const { repository, checkout, requests } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	gitOutput(checkout.dir, ['checkout', '--detach']);
	const event = {
		GITHUB_REF: 'refs/pull/7/merge',
		GITHUB_REF_NAME: '7/merge',
		GITHUB_BASE_REF: 'main',
		GITHUB_SHA: checkout.sha,
	};
	const refusal = 'The checkout is the merge commit of a pull request';
	await expect(open(repository, checkout.dir, event)).rejects.toThrow('The checkout is on no branch');
	await expect(open(repository, checkout.dir, { ...event, PR_BASE: 'main' })).rejects.toThrow(refusal);
	expect(requests).toEqual([]);
	expect(repository.pulls).toEqual([]);
});

test('a pull request run that checked out its head branch opens a pull request against that branch', async () => {
	const { repository, checkout } = checkedOut();
	repository.refs.set('heads/feature', checkout.sha);
	gitOutput(checkout.dir, ['checkout', '-b', 'feature']);
	writeFileSync(join(checkout.dir, 'README.md'), '# widget\n\nFormatted.\n');
	await open(repository, checkout.dir, {
		GITHUB_REF: 'refs/pull/7/merge',
		GITHUB_REF_NAME: '7/merge',
		GITHUB_BASE_REF: 'main',
		GITHUB_SHA: 'a'.repeat(40),
	});
	expect(repository.pulls.map(pull => [pull.head.ref, pull.base])).toEqual([['autofix/format', 'feature']]);
});

test('binary bytes, symlinks, gitlinks and mode-only changes survive the full action', async () => {
	const { repository, checkout } = checkedOut();
	const bytes = Buffer.from([0, 255, 254, 128, 10]);
	writeFileSync(join(checkout.dir, 'binary.dat'), bytes);
	symlinkSync('README.md', join(checkout.dir, 'link'));
	chmodSync(join(checkout.dir, 'README.md'), 0o755);
	const sub = materialize({ 'nested.txt': 'nested' });
	directories.push(sub.dir);
	gitOutput(checkout.dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', sub.dir, 'module']);
	const before = gitOutput(checkout.dir, ['diff', '--cached', '--binary']);
	const result = await open(repository, checkout.dir);
	expect(gitOutput(checkout.dir, ['diff', '--cached', '--binary'])).toBe(before);
	const tree = repository.trees.get(world.github.resolve(repository, result.headSha ?? '').tree)!;
	expect(repository.blobs.get(tree.get('binary.dat')!.sha)).toEqual(bytes);
	expect(tree.get('link')?.mode).toBe('120000');
	expect(repository.blobs.get(tree.get('link')!.sha)?.toString()).toBe('README.md');
	expect(tree.get('README.md')?.mode).toBe('100755');
	expect(tree.get('module')).toEqual({ mode: '160000', type: 'commit', sha: sub.sha });
});

test('file-directory transitions preserve the exact local tree', async () => {
	const { repository, checkout } = checkedOut();
	rmSync(join(checkout.dir, 'LICENSE'));
	mkdirSync(join(checkout.dir, 'LICENSE'));
	writeFileSync(join(checkout.dir, 'LICENSE', 'notice'), 'license');
	rmSync(join(checkout.dir, '.github'), { recursive: true });
	writeFileSync(join(checkout.dir, '.github'), 'file');
	const result = await open(repository, checkout.dir);
	expect(filesAt(repository, result.headSha ?? '')['LICENSE/notice']).toBe('license');
	expect(filesAt(repository, result.headSha ?? '')['.github']).toBe('file');
});

test('preflight refuses a missing base and an unowned branch before writes and preserves partial staging', async () => {
	const { repository, checkout, requests } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), 'staged');
	gitOutput(checkout.dir, ['add', 'README.md']);
	writeFileSync(join(checkout.dir, 'README.md'), 'working');
	const before = gitOutput(checkout.dir, ['diff', '--cached', '--binary']);
	await expect(open(repository, checkout.dir, { PR_BASE: 'missing' })).rejects.toThrow('404');
	repository.refs.set('heads/autofix/format', checkout.sha);
	await expect(open(repository, checkout.dir)).rejects.toThrow('not owned');
	expect(requests.filter(request => request.startsWith('POST'))).toEqual([]);
	expect(repository.refs.get('heads/autofix/format')).toBe(checkout.sha);
	expect(gitOutput(checkout.dir, ['diff', '--cached', '--binary'])).toBe(before);
	await open(repository, checkout.dir, { PR_ALLOW_EXISTING_BRANCH: 'true' });
	expect(gitOutput(checkout.dir, ['diff', '--cached', '--binary'])).toBe(before);
	repository.refs.set('heads/other', checkout.sha);
	await expect(open(repository, checkout.dir, { PR_BASE: 'other', PR_ALLOW_EXISTING_BRANCH: 'true' })).rejects.toThrow(
		'another base',
	);
});

test('a stale overlapping publisher cannot overwrite a newer branch', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), 'initial');
	await open(repository, checkout.dir);
	let release!: () => void, entered!: () => void;
	const held = new Promise<void>(resolve => {
		release = resolve;
	});
	const reached = new Promise<void>(resolve => {
		entered = resolve;
	});
	let first = true;
	world.network.serve('api.github.com', async request => {
		if (new URL(request.url).pathname === '/graphql' && first) {
			first = false;
			entered();
			await held;
		}
		return world.github.handle(request);
	});
	writeFileSync(join(checkout.dir, 'README.md'), 'old overlapping update');
	const stale = open(repository, checkout.dir).then(
		value => ({ value, error: undefined }),
		error => ({ value: undefined, error }),
	);
	await reached;
	writeFileSync(join(checkout.dir, 'README.md'), 'new update');
	const newer = await open(repository, checkout.dir);
	release();
	expect((await stale).error?.message).toContain('changed concurrently');
	expect(repository.refs.get('heads/autofix/format')).toBe(newer.headSha);
	expect(filesAt(repository, newer.headSha ?? '')['README.md']).toBe('new update');
});

test('simultaneous identical branch and PR creation converges', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), 'same');
	let release!: () => void, entered!: () => void;
	const held = new Promise<void>(resolve => {
		release = resolve;
	});
	const reached = new Promise<void>(resolve => {
		entered = resolve;
	});
	let first = true;
	world.network.serve('api.github.com', async request => {
		if (new URL(request.url).pathname.endsWith('/pulls') && request.method === 'POST' && first) {
			first = false;
			entered();
			await held;
		}
		return world.github.handle(request);
	});
	const a = open(repository, checkout.dir);
	await reached;
	const b = await open(repository, checkout.dir);
	release();
	const result = await a;
	expect(result.headSha).toBe(b.headSha);
	expect(repository.pulls).toHaveLength(1);
});

test.each(['/git/blobs', '/git/trees', '/git/commits', '/graphql', '/pulls'])(
	'rerunning converges after a failed response at %s',
	async route => {
		const { repository, checkout } = checkedOut();
		writeFileSync(join(checkout.dir, 'README.md'), 'retry');
		let once = true;
		world.network.serve('api.github.com', async request => {
			if (once && request.method === 'POST' && new URL(request.url).pathname.endsWith(route)) {
				once = false;
				await world.github.handle(request);
				return new Response('lost response', { status: 503 });
			}
			return world.github.handle(request);
		});
		await open(repository, checkout.dir).catch(() => undefined);
		const result = await open(repository, checkout.dir);
		expect(repository.pulls).toHaveLength(1);
		expect(repository.pulls[0]?.head.sha).toBe(result.headSha);
		expect(filesAt(repository, result.headSha ?? '')['README.md']).toBe('retry');
	},
);

test('oversized blobs are refused before remote writes', async () => {
	const { repository, checkout, requests } = checkedOut();
	writeFileSync(join(checkout.dir, 'large'), Buffer.alloc(10 * 1024 * 1024 + 1));
	await expect(open(repository, checkout.dir)).rejects.toThrow('10 MiB');
	expect(requests).toEqual([]);
});

test.each([true, false])(
	'simultaneous first branch creation converges only for identical work: %s',
	async identical => {
		const { repository, checkout } = checkedOut();
		writeFileSync(join(checkout.dir, 'README.md'), 'first');
		let release!: () => void, entered!: () => void;
		const held = new Promise<void>(resolve => {
			release = resolve;
		});
		const reached = new Promise<void>(resolve => {
			entered = resolve;
		});
		let first = true;
		world.network.serve('api.github.com', async request => {
			if (new URL(request.url).pathname === '/graphql' && first) {
				first = false;
				entered();
				await held;
			}
			return world.github.handle(request);
		});
		const a = open(repository, checkout.dir).then(
			value => ({ value, error: undefined }),
			error => ({ value: undefined, error }),
		);
		await reached;
		if (!identical) writeFileSync(join(checkout.dir, 'README.md'), 'winner');
		const b = await open(repository, checkout.dir);
		release();
		const result = await a;
		if (identical) expect(result.value?.headSha).toBe(b.headSha);
		else expect(result.error?.message).toContain('changed concurrently');
		expect(repository.refs.get('heads/autofix/format')).toBe(b.headSha);
		expect(repository.pulls).toHaveLength(1);
	},
);

test('a metadata failure retains the new owned branch and the rerun completes the same PR', async () => {
	const { repository, checkout } = checkedOut();
	writeFileSync(join(checkout.dir, 'README.md'), 'one');
	const first = await open(repository, checkout.dir);
	writeFileSync(join(checkout.dir, 'README.md'), 'two');
	let refuse = true;
	world.network.serve(
		'api.github.com',
		request =>
			request.method === 'PATCH' && new URL(request.url).pathname.includes('/pulls/') && refuse
				? new Response('Unavailable', { status: 503 })
				: world.github.handle(request),
	);
	await expect(open(repository, checkout.dir, { PR_TITLE: 'New title' })).rejects.toThrow('503');
	const head = repository.refs.get('heads/autofix/format');
	expect(head).not.toBe(first.headSha);
	refuse = false;
	const result = await open(repository, checkout.dir, { PR_TITLE: 'New title' });
	expect(result.headSha).toBe(head);
	expect(repository.pulls).toHaveLength(1);
	expect(repository.pulls[0]?.title).toBe('New title');
});

test.each(['paths', 'bytes'])('aggregate %s limits fail before API calls', async kind => {
	const { repository, checkout, requests } = checkedOut();
	const count = kind === 'paths' ? 501 : 6,
		content = kind === 'paths' ? Buffer.from('x') : Buffer.alloc(9 * 1024 * 1024);
	for (let i = 0; i < count; i++) writeFileSync(join(checkout.dir, `file-${i}`), content);
	await expect(open(repository, checkout.dir)).rejects.toThrow(kind === 'paths' ? '500-file' : '50 MiB');
	expect(requests).toEqual([]);
});
