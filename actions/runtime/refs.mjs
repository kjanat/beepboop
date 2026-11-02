// @ts-check
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @typedef {import('@/automation/refs').RefPlan} RefPlan */
/** @typedef {import('@/automation/refs').RefChange} RefChange */
/** @typedef {ReturnType<typeof createGit>} Git */

/**
 * Run Git in the checkout, keeping authentication out of arguments and errors.
 * @param {string} root
 * @param {string} [token]
 */
function createGit(root, token) {
	const env = { ...process.env };
	if (token) {
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
		env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	}
	/** @param {string[]} args */
	const run = (...args) => spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
	return {
		/** @param {string[]} args */
		read(...args) {
			const result = run(...args);
			if (result.status !== 0) throw Error(`Git ${args[0]} failed; inspect the repository and ref plan`);
			return result.stdout.trim();
		},
		/** @param {string} ref */
		exists(ref) {
			return run('rev-parse', '--verify', ref).status === 0;
		},
	};
}

/**
 * Verify both the annotated tag object and its target before accepting a retry.
 * @param {Git} git
 * @param {string} ref
 * @param {RefChange} change
 * @param {string} message
 */
function verifyTag(git, ref, change, message) {
	if (git.read('cat-file', '-t', ref) !== 'tag' || git.read('rev-parse', `${ref}^{commit}`) !== change.commit) {
		throw Error(message);
	}
	if (change.signed) git.read('verify-tag', ref);
}

/**
 * Recheck an already published version tag without overwriting it.
 * @param {Git} git
 * @param {string} remote
 * @param {string} ref
 * @param {RefChange} change
 */
function verifyPublishedTag(git, remote, ref, change) {
	git.read('fetch', '--no-tags', remote, ref);
	if (git.read('rev-parse', 'FETCH_HEAD') !== change.expected) throw Error('Published version tag changed');
	verifyTag(git, 'FETCH_HEAD', change, 'Published version tag changed');
}

/**
 * Create a version tag or reuse a matching local tag after verification.
 * @param {Git} git
 * @param {string} ref
 * @param {RefChange} change
 * @param {string} version
 * @returns {string} Tag object ID to publish.
 */
function prepareTag(git, ref, change, version) {
	if (git.exists(ref)) {
		verifyTag(git, ref, change, 'Local tag differs from the ref plan');
	} else {
		git.read('tag', change.signed ? '-s' : '-a', '-m', `Release ${version}`, '--', change.name, change.commit);
	}
	return git.read('rev-parse', ref);
}

/**
 * Publish the planned tags atomically, using a lease for every changed ref.
 * @param {RefPlan} plan
 * @param {string} root Checkout directory.
 * @param {string} remote Git remote name or URL.
 * @param {string} [token] GitHub token for HTTPS authentication.
 * @returns {void}
 */
export function publishRefs(plan, root, remote, token) {
	const git = createGit(root, token);
	/** @type {string[]} */
	const leases = [];
	/** @type {string[]} */
	const refspecs = [];
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

/** Read the GitHub Action inputs only when invoked as the entrypoint. */
function main() {
	const { REF_PLAN, REF_TOKEN, GITHUB_WORKSPACE } = process.env;
	if (!REF_PLAN) throw Error('Ref plan required');
	if (!REF_TOKEN) throw Error('Destination token required');
	if (!GITHUB_WORKSPACE) throw Error('Checkout directory required');
	/** @type {RefPlan} */
	const plan = JSON.parse(REF_PLAN);
	if (!/^[\w.-]+\/[\w.-]+$/.test(plan.repository)) throw Error('Invalid destination');
	publishRefs(plan, GITHUB_WORKSPACE, `https://github.com/${plan.repository}.git`, REF_TOKEN);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
