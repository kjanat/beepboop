import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planRefs, type RefPolicy } from '#automation/refs';
// @ts-expect-error The runtime Action is plain JavaScript.
import { publishRefs } from '../actions/runtime/refs.mjs';

const commit = 'a'.repeat(40), old = 'b'.repeat(40);
const policy: RefPolicy = { phase: 'aliases', prefix: 'v', aliases: ['major', 'minor'], signed: false };
test('aliases follow stable versions and reject backwards movement', () => {
	expect(planRefs(policy, '2.4.3', commit, [{ name: 'v2.4.3', oid: commit, commit }]).map(r => r.name)).toEqual([
		'v2',
		'v2.4',
	]);
	expect(planRefs(policy, '2.5.0-alpha.1', commit, [{ name: 'v2.5.0-alpha.1', oid: commit, commit }])).toEqual([]);
	expect(() =>
		planRefs(policy, '2.4.3', commit, [{ name: 'v2.4.3', oid: commit, commit }, {
			name: 'v2.5.0',
			oid: old,
			commit: old,
		}])
	).toThrow('downgrade');
	expect(() => planRefs({ ...policy, phase: 'version' }, '2.4.3', commit, [{ name: 'v2.4.3', oid: old, commit: old }]))
		.toThrow('another commit');
});
test('ref Action publishes an annotated tag and aliases, rejecting a concurrent change atomically', () => {
	const root = mkdtempSync(join(tmpdir(), 'beepboop-refs-'));
	const git = (...args: string[]) => {
		const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
		if (r.status !== 0) throw Error(r.stderr);
		return r.stdout.trim();
	};
	try {
		git('init', '--bare', 'remote.git');
		git('init', 'work');
		const work = join(root, 'work'), remote = join(root, 'remote.git');
		git('-C', work, 'config', 'user.name', 'Fixture');
		git('-C', work, 'config', 'user.email', 'fixture@example.test');
		git('-C', work, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture');
		const sha = git('-C', work, 'rev-parse', 'HEAD');
		const plan = {
			repository: 'example/action',
			executionId: 'test',
			version: '2.4.3',
			changes: planRefs({ ...policy, phase: 'version' }, '2.4.3', sha, []),
		};
		publishRefs(plan, work, remote);
		expect(git('--git-dir', remote, 'cat-file', '-t', 'refs/tags/v2.4.3')).toBe('tag');
		const tag = git('--git-dir', remote, 'rev-parse', 'refs/tags/v2.4.3');
		publishRefs(
			{
				...plan,
				changes: planRefs({ ...policy, phase: 'version' }, '2.4.3', sha, [{ name: 'v2.4.3', oid: tag, commit: sha }]),
			},
			work,
			remote,
		);
		const aliases = { ...plan, changes: planRefs(policy, '2.4.3', sha, [{ name: 'v2.4.3', oid: tag, commit: sha }]) };
		publishRefs(aliases, work, remote);
		expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/v2')).toBe(sha);
		expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/v2.4')).toBe(sha);
		const conflict = {
			...plan,
			changes: [{ name: 'v2', expected: 'c'.repeat(40), commit: sha, annotated: false, signed: false }, {
				name: 'v3',
				expected: null,
				commit: sha,
				annotated: false,
				signed: false,
			}],
		};
		// Force a refspec change so Git must evaluate its lease.
		git('-C', work, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'next');
		const first = conflict.changes[0];
		if (!first) throw new Error('Missing fixture change');
		first.commit = git('-C', work, 'rev-parse', 'HEAD');
		expect(() => publishRefs(conflict, work, remote)).toThrow();
		expect(
			spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/tags/v3'], { encoding: 'utf8' }).status,
		).not.toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
