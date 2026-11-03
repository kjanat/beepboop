#!/usr/bin/env bun

import { resolve } from 'node:path';
import { z } from 'zod';
import { discover, resolvePublished } from '@/automation/managers';
import { tagQueries } from '@/automation/managers/tags';
import { onboardingConfiguration } from '@/automation/onboarding';
import type { Snapshot } from '@/automation/types';

function command(args: string[]): string {
	const result = Bun.spawnSync(args);
	if (result.exitCode !== 0) throw new Error('Could not read repository revision');
	return new TextDecoder().decode(result.stdout);
}
const selected = (path: string) =>
	!/(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.build)\//.test(path)
	&& /(?:^|\/)(?:\.pre-commit-config\.ya?ml|targets.json|Cargo.toml|Cargo.lock|package.json|jsr.json|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock|go\.mod|PKGBUILD|\.?goreleaser[^/]*\.ya?ml)$|^\.github\/(?:beepboop.json|workflows\/[^/]+\.ya?ml)$/
		.test(
			path,
		);
const lock = (path: string) => /(?:Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path);
let snapshot: Snapshot;
if (process.argv[2] === '--github') {
	const name = process.argv[3];
	if (!name || !/^\w[\w.-]*\/[\w.-]+$/.test(name)) throw new Error('Expected owner/repository');
	const gh = <T extends z.ZodType>(path: string, schema: T): z.output<T> =>
		schema.parse(JSON.parse(command(['gh', 'api', path])));
	const metadata = gh(`repos/${name}`, z.object({ id: z.number(), default_branch: z.string() }));
	const { sha } = gh(
		`repos/${name}/commits/${encodeURIComponent(metadata.default_branch)}`,
		z.object({ sha: z.string() }),
	);
	const tree = gh(
		`repos/${name}/git/trees/${sha}?recursive=1`,
		z.object({
			truncated: z.boolean(),
			tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
		}),
	);
	if (tree.truncated) throw new Error('Truncated repository tree');
	const files: Record<string, string> = {};
	for (const entry of tree.tree) {
		if (entry.type === 'blob' && entry.mode !== '120000' && selected(entry.path)) {
			if (lock(entry.path)) {
				files[entry.path] = '';
				continue;
			}
			const file = gh(
				`repos/${name}/contents/${entry.path}?ref=${sha}`,
				z.object({ size: z.number(), content: z.string() }),
			);
			if (file.size > 1048576) throw new Error('Discovery file limit exceeded');
			files[entry.path] = Buffer.from(file.content, 'base64').toString('utf8');
		}
	}
	const tags = tagQueries(Object.keys(files)).flatMap(prefix =>
		gh(`repos/${name}/git/matching-refs/tags/${prefix}`, z.array(z.object({ ref: z.string() }))).map(row =>
			row.ref.slice('refs/tags/'.length)
		)
	);
	snapshot = {
		repository: { id: metadata.id, name, defaultBranch: metadata.default_branch },
		sha,
		files,
		tags: [...new Set<string>(tags)].sort(),
	};
} else {
	const root = resolve(process.argv[2] ?? '.');
	const git = (...args: string[]) => command(['git', '-C', root, ...args]);
	const sha = git('rev-parse', 'HEAD').trim();
	const files: Record<string, string> = {};
	for (const path of git('ls-tree', '-r', '--name-only', sha).split('\n').filter(selected)) {
		files[path] = lock(path) ? '' : git('show', `${sha}:${path}`);
	}
	const tags = git('tag', '--list').split('\n').filter(Boolean);
	snapshot = { repository: { id: 1, name: 'local/inspection', defaultBranch: 'HEAD' }, sha, files, tags };
}
function githubApi(path: string): unknown {
	const result = Bun.spawnSync(['gh', 'api', path]);
	if (result.exitCode === 0) return JSON.parse(new TextDecoder().decode(result.stdout));
	if (new TextDecoder().decode(result.stderr).includes('HTTP 404')) return null;
	throw new Error(`gh api ${path} failed`);
}
const inventory = await resolvePublished(
	discover(snapshot),
	fetch,
	process.argv[2] === '--github'
		? { repository: snapshot.repository.name, github: async path => githubApi(path) }
		: undefined,
);
console.log(
	JSON.stringify(
		{
			repository: snapshot.repository,
			sha: snapshot.sha,
			inventory,
			proposedConfiguration: onboardingConfiguration(snapshot, inventory),
		},
		null,
		2,
	),
);
