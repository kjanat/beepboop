import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/publish-actions.yml', 'utf8'));
const publish = workflow.jobs.publish.steps.find((step: { name?: string }) =>
	step.name === 'Publish distribution commit'
).run as string;

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'action-publication-'));
	const work = join(root, 'work'), remote = join(root, 'remote.git');
	const git = (...args: string[]) => {
		const result = spawnSync('git', ['-C', work, ...args], { encoding: 'utf8' });
		if (result.status !== 0) throw new Error(result.stderr);
		return result.stdout.trim();
	};
	mkdirSync(work);
	git('init', '-q', '-b', 'master');
	git('init', '--bare', remote);
	git('config', 'user.name', 'Fixture');
	git('config', 'user.email', 'fixture@example.invalid');
	git('config', 'commit.gpgsign', 'false');
	git('remote', 'add', 'origin', remote);
	mkdirSync(join(work, 'actions', 'generate-winget'), { recursive: true });
	mkdirSync(join(work, 'actions', 'runtime'), { recursive: true });
	writeFileSync(join(work, '.gitignore'), '/dist/\n/actions/**/dist/\n');
	writeFileSync(join(work, 'actions', 'generate-winget', 'action.yml'), 'runs: {using: composite}\n');
	writeFileSync(join(work, 'actions', 'runtime', 'client.mjs'), 'export {};\n');
	writeFileSync(join(work, 'source.txt'), 'first\n');
	git('add', '.');
	git('commit', '-qm', 'source');
	git('push', '-q', 'origin', 'master');
	const run = (source = git('rev-parse', 'HEAD')) =>
		spawnSync('bash', ['-euo', 'pipefail', '-c', publish], {
			cwd: work,
			encoding: 'utf8',
			env: {
				...process.env,
				GITHUB_SHA: source,
				repository_url: 'https://github.example/owner/repo',
				GIT_AUTHOR_NAME: 'beepboop[bot]',
				GIT_AUTHOR_EMAIL: '123+beepboop[bot]@users.noreply.github.com',
				GIT_COMMITTER_NAME: 'beepboop[bot]',
				GIT_COMMITTER_EMAIL: '123+beepboop[bot]@users.noreply.github.com',
				GITHUB_SERVER_URL: 'https://github.example',
				GITHUB_REPOSITORY: 'owner/repo',
				GITHUB_STEP_SUMMARY: join(root, 'summary'),
			},
		});
	const head = () => git('--git-dir', remote, 'rev-parse', 'refs/heads/actions');
	return { root, work, remote, git, run, head };
}

test('publication publishes the source tree and shared Actions', () => {
	const { root, git, run, head } = fixture();
	try {
		const source = git('rev-parse', 'HEAD');
		const result = run();
		expect(result.status, result.stderr).toBe(0);
		const published = head();
		expect(git('show', '-s', '--format=%an <%ae>%n%cn <%ce>', published)).toBe(
			'beepboop[bot] <123+beepboop[bot]@users.noreply.github.com>\nbeepboop[bot] <123+beepboop[bot]@users.noreply.github.com>',
		);
		expect(git('rev-parse', `${published}^1`)).toBe(source);
		expect(git('diff', '--name-only', source, published)).toBe('');
		expect(git('show', `${published}:actions/runtime/client.mjs`)).toBe('export {};');
		expect(git('rev-parse', 'refs/heads/master')).toBe(source);
		expect(readFileSync(join(root, 'summary'), 'utf8')).toContain(`generate-winget@${published}`);
		const summary = readFileSync(join(root, 'summary'), 'utf8');
		expect(summary).toContain(`](https://github.example/owner/repo/commit/${source})`);
		expect(summary).toContain(`](https://github.example/owner/repo/commit/${published})`);
		expect(run().status).toBe(0);
		expect(readFileSync(join(root, 'summary'), 'utf8')).toContain(
			`Actions already published at [\`${published}\`](https://github.example/owner/repo/commit/${published}).`,
		);
		expect(head()).toBe(published);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('updated publication fast-forwards the distribution and rejects older source', () => {
	const { root, work, git, run, head } = fixture();
	try {
		const source = git('rev-parse', 'HEAD');
		expect(run().status).toBe(0);
		const first = head();
		writeFileSync(join(work, 'source.txt'), 'second\n');
		git('add', 'source.txt');
		git('commit', '-qm', 'next source');
		const next = git('rev-parse', 'HEAD');
		const result = run();
		expect(result.status, result.stderr).toBe(0);
		const second = head();
		expect(git('rev-parse', `${second}^1`)).toBe(next);
		expect(git('rev-parse', `${second}^2`)).toBe(first);
		expect(git('merge-base', '--is-ancestor', first, second)).toBe('');
		git('checkout', '--detach', source);
		expect(run(source).status).not.toBe(0);
		expect(head()).toBe(second);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('publication refuses a concurrent distribution branch update', () => {
	const { root, work, remote, git, run, head } = fixture();
	try {
		const source = git('rev-parse', 'HEAD');
		const competing = git('commit-tree', 'HEAD^{tree}', '-p', source, '-m', 'concurrent publication');
		git('push', '-q', 'origin', `${competing}:refs/heads/competitor`);
		writeFileSync(
			join(work, '.git', 'hooks', 'pre-push'),
			`#!/bin/sh\ngit --git-dir='${remote}' update-ref refs/heads/actions '${competing}'\n`,
			{ mode: 0o755 },
		);
		const result = run();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('failed to push');
		expect(head()).toBe(competing);
		expect(git('rev-parse', 'refs/heads/master')).toBe(source);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('publication push credentials and both commit identities come from Beepboop', () => {
	const job = workflow.jobs.publish;
	expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
	const checkouts = job.steps.filter((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
	expect(checkouts[0].with['persist-credentials']).toBe(false);
	expect(checkouts[1].with.token).toBe(`\${{ steps.bot.outputs.token }}`);
	expect(checkouts[1].with.ref).toBe(`\${{ github.sha }}`);
	const bot = job.steps.find((step: { id?: string }) => step.id === 'bot');
	expect(bot.uses).toBe('$/actions/token');
	expect(bot.with.purpose).toBe('publish-actions');
	expect(JSON.parse(bot.with.permissions)).toEqual({ contents: 'write', workflows: 'write' });
	const env = job.steps.find((step: { name?: string }) => step.name === 'Publish distribution commit').env;
	for (const role of ['AUTHOR', 'COMMITTER']) {
		expect(env[`GIT_${role}_NAME`]).toBe(`\${{ steps.bot.outputs.bot-login }}`);
		expect(env[`GIT_${role}_EMAIL`]).toBe(`\${{ steps.bot.outputs.bot-email }}`);
	}
	expect(publish).not.toContain('github-actions[bot]');
});
