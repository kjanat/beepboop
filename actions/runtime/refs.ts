import { spawnSync } from 'node:child_process';
import type { RefChange, RefPlan } from '../../src/automation/refs.ts';
import { array, boolean, record, text } from '../../src/model.ts';

interface Git {
	read(...args: string[]): string;
	exists(ref: string): boolean;
}

function createGit(root: string, token?: string): Git {
	const env = { ...process.env };
	if (token) {
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
		env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	}
	const run = (...args: string[]) => spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
	return {
		read(...args) {
			const result = run(...args);
			if (result.status !== 0) throw Error(`Git ${args[0]} failed; inspect the repository and ref plan`);
			return result.stdout.trim();
		},
		exists(ref) {
			return run('rev-parse', '--verify', ref).status === 0;
		},
	};
}

function verifyTag(git: Git, ref: string, change: RefChange, message: string): void {
	if (git.read('cat-file', '-t', ref) !== 'tag' || git.read('rev-parse', `${ref}^{commit}`) !== change.commit) {
		throw Error(message);
	}
	if (change.signed) git.read('verify-tag', ref);
}

function verifyPublishedTag(git: Git, remote: string, ref: string, change: RefChange): void {
	git.read('fetch', '--no-tags', remote, ref);
	if (git.read('rev-parse', 'FETCH_HEAD') !== change.expected) throw Error('Published version tag changed');
	verifyTag(git, 'FETCH_HEAD', change, 'Published version tag changed');
}

function prepareTag(git: Git, ref: string, change: RefChange, version: string): string {
	if (git.exists(ref)) {
		verifyTag(git, ref, change, 'Local tag differs from the ref plan');
	} else {
		git.read('tag', change.signed ? '-s' : '-a', '-m', `Release ${version}`, '--', change.name, change.commit);
	}
	return git.read('rev-parse', ref);
}

export function publishRefs(plan: RefPlan, root: string, remote: string, token?: string): void {
	const git = createGit(root, token);
	const leases: string[] = [];
	const refspecs: string[] = [];
	for (const change of plan.changes) {
		if (!/^[a-f0-9]{40}$/.test(change.commit) || change.expected !== null && !/^[a-f0-9]{40}$/.test(change.expected)) {
			throw Error('Invalid ref object');
		}
		const ref = `refs/tags/${change.name}`;
		git.read('check-ref-format', ref);
		git.read('cat-file', '-e', `${change.commit}^{commit}`);
		if (change.annotated && change.expected !== null) {
			verifyPublishedTag(git, remote, ref, change);
			continue;
		}
		const object = change.annotated ? prepareTag(git, ref, change, plan.version) : change.commit;
		leases.push(`--force-with-lease=${ref}:${change.expected ?? ''}`);
		refspecs.push(`${object}:${ref}`);
	}
	if (refspecs.length) git.read('push', '--atomic', ...leases, remote, ...refspecs);
}

function parsePlan(value: unknown): RefPlan {
	const plan = record(value);
	return {
		repository: text(plan.repository),
		executionId: text(plan.executionId),
		version: text(plan.version),
		changes: array(plan.changes).map(entry => {
			const change = record(entry);
			return {
				name: text(change.name),
				expected: change.expected === null ? null : text(change.expected),
				commit: text(change.commit),
				annotated: boolean(change.annotated),
				signed: boolean(change.signed),
			};
		}),
	};
}

if (import.meta.main) {
	const { REF_PLAN, REF_TOKEN, GITHUB_WORKSPACE } = process.env;
	if (!REF_PLAN) throw Error('Ref plan required');
	if (!REF_TOKEN) throw Error('Destination token required');
	if (!GITHUB_WORKSPACE) throw Error('Checkout directory required');
	const plan = parsePlan(JSON.parse(REF_PLAN));
	if (!/^[\w.-]+\/[\w.-]+$/.test(plan.repository)) throw Error('Invalid destination');
	publishRefs(plan, GITHUB_WORKSPACE, `https://github.com/${plan.repository}.git`, REF_TOKEN);
}
