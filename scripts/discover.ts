import { resolve } from 'node:path';
import { discover } from '#automation/managers';
import { onboardingConfiguration } from '#automation/onboarding';
import type { Snapshot } from '#automation/types';

function command(args: string[]): string {
	const result = Bun.spawnSync(args);
	if (result.exitCode !== 0) throw new Error('Could not read repository revision');
	return new TextDecoder().decode(result.stdout);
}
const selected = (path: string) =>
	!/(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.build)\//.test(path)
	&& /(?:^|\/)(?:\.pre-commit-config\.ya?ml|targets.json|Cargo.toml|Cargo.lock|package.json|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock|\.?goreleaser[^/]*\.ya?ml)$|^\.github\/(?:beepboop.json|workflows\/[^/]+\.ya?ml)$/
		.test(
			path,
		);
const lock = (path: string) => /(?:Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path);
let snapshot: Snapshot;
if (process.argv[2] === '--github') {
	const name = process.argv[3];
	if (!name || !/^\w[\w.-]*\/[\w.-]+$/.test(name)) throw new Error('Expected owner/repository');
	const gh = (path: string) => JSON.parse(command(['gh', 'api', path]));
	const metadata = gh(`repos/${name}`);
	const revision = gh(`repos/${name}/commits/${encodeURIComponent(metadata.default_branch)}`);
	const sha = revision.sha;
	const tree = gh(`repos/${name}/git/trees/${sha}?recursive=1`);
	if (tree.truncated) throw new Error('Truncated repository tree');
	const files: Record<string, string> = {};
	for (const entry of tree.tree) {
		if (entry.type === 'blob' && entry.mode !== '120000' && selected(entry.path)) {
			if (lock(entry.path)) {
				files[entry.path] = '';
				continue;
			}
			const file = gh(`repos/${name}/contents/${entry.path}?ref=${sha}`);
			if (file.size > 1048576) throw new Error('Discovery file limit exceeded');
			files[entry.path] = Buffer.from(file.content, 'base64').toString('utf8');
		}
	}
	snapshot = {
		repository: { id: metadata.id, name, defaultBranch: metadata.default_branch },
		sha,
		files,
	};
} else {
	const root = resolve(process.argv[2] ?? '.');
	const git = (...args: string[]) => command(['git', '-C', root, ...args]);
	const sha = git('rev-parse', 'HEAD').trim();
	const files: Record<string, string> = {};
	for (const path of git('ls-tree', '-r', '--name-only', sha).split('\n').filter(selected)) {
		files[path] = lock(path) ? '' : git('show', `${sha}:${path}`);
	}
	snapshot = { repository: { id: 1, name: 'local/inspection', defaultBranch: 'HEAD' }, sha, files };
}
const inventory = discover(snapshot);
console.log(
	JSON.stringify(
		{
			repository: snapshot.repository,
			sha: snapshot.sha,
			inventory,
			proposedConfiguration: onboardingConfiguration(inventory),
		},
		null,
		2,
	),
);
