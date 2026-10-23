import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function publishRefs(plan, root, remote, token) {
	const env = { ...process.env };
	if (token) {
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
		env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	}
	const git = (...args) => {
		const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
		if (result.status !== 0) throw Error(`Git ${args[0]} failed; inspect the repository and ref plan`);
		return result.stdout.trim();
	};
	const leases = [], refspecs = [];
	for (const change of plan.changes) {
		if (!/^[a-f0-9]{40}$/.test(change.commit) || change.expected !== null && !/^[a-f0-9]{40}$/.test(change.expected)) {
			throw Error('Invalid ref object');
		}
		const ref = `refs/tags/${change.name}`;
		git('check-ref-format', ref);
		git('cat-file', '-e', `${change.commit}^{commit}`);
		let object = change.commit;
		if (change.annotated && change.expected !== null) {
			git('fetch', '--no-tags', remote, ref);
			if (
				git('rev-parse', 'FETCH_HEAD') !== change.expected || git('cat-file', '-t', 'FETCH_HEAD') !== 'tag'
				|| git('rev-parse', 'FETCH_HEAD^{commit}') !== change.commit
			) throw Error('Published version tag changed');
			if (change.signed) git('verify-tag', 'FETCH_HEAD');
			continue;
		}
		if (change.annotated) {
			const existing = spawnSync('git', ['rev-parse', '--verify', ref], { cwd: root, env, encoding: 'utf8' });
			if (existing.status === 0) {
				if (git('cat-file', '-t', ref) !== 'tag' || git('rev-parse', `${ref}^{commit}`) !== change.commit) {
					throw Error('Local tag differs from the ref plan');
				}
				if (change.signed) git('verify-tag', ref);
			} else git('tag', change.signed ? '-s' : '-a', '-m', `Release ${plan.version}`, '--', change.name, change.commit);
			object = git('rev-parse', ref);
		}
		leases.push(`--force-with-lease=${ref}:${change.expected ?? ''}`);
		refspecs.push(`${object}:${ref}`);
	}
	if (refspecs.length) git('push', '--atomic', ...leases, remote, ...refspecs);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const plan = JSON.parse(process.env.REF_PLAN);
	if (!/^[\w.-]+\/[\w.-]+$/.test(plan.repository)) throw Error('Invalid destination');
	if (!process.env.REF_TOKEN) throw Error('Destination token required');
	publishRefs(plan, process.env.GITHUB_WORKSPACE, `https://github.com/${plan.repository}.git`, process.env.REF_TOKEN);
}
