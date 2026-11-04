#!/usr/bin/env bun

import { resolve } from 'node:path';
import { z } from 'zod';
import { discover, resolvePublished } from '@/automation/managers';
import { onboardingConfiguration } from '@/automation/onboarding';
import { buildSnapshot } from '@/automation/snapshot';
import type { Snapshot } from '@/automation/types';

function command(args: string[]): string {
	const result = Bun.spawnSync(args);
	if (result.exitCode !== 0) throw new Error('Could not read repository revision');
	return new TextDecoder().decode(result.stdout);
}
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
	snapshot = await buildSnapshot({
		repository: { id: metadata.id, name, defaultBranch: metadata.default_branch },
		sha,
		entries: tree.tree,
		read: async path => {
			const file = gh(`repos/${name}/contents/${path}?ref=${sha}`, z.object({ size: z.number(), content: z.string() }));
			if (file.size > 1048576) throw new Error('Discovery file limit exceeded');
			return Buffer.from(file.content, 'base64').toString('utf8');
		},
		tags: async prefixes =>
			prefixes.flatMap(prefix =>
				gh(`repos/${name}/git/matching-refs/tags/${prefix}`, z.array(z.object({ ref: z.string() }))).map(row =>
					row.ref.slice('refs/tags/'.length)
				)
			),
	});
} else {
	const root = resolve(process.argv[2] ?? '.');
	const git = (...args: string[]) => command(['git', '-C', root, ...args]);
	const sha = git('rev-parse', 'HEAD').trim();
	const remote = Bun.spawnSync(['git', '-C', root, 'remote', 'get-url', 'origin']);
	const name = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(new TextDecoder().decode(remote.stdout).trim())?.[1]
		?? 'local/inspection';
	const tags = git('tag', '--list').split('\n').filter(Boolean);
	snapshot = await buildSnapshot({
		repository: { id: 1, name, defaultBranch: 'HEAD' },
		sha,
		entries: git('ls-tree', '-r', '-z', sha).split('\0').filter(Boolean).map(line => {
			const [meta = '', path = ''] = line.split('\t');
			const [mode = '', type = ''] = meta.split(' ');
			return { path, type, mode };
		}),
		read: async path => git('show', `${sha}:${path}`),
		tags: async prefixes => tags.filter(tag => prefixes.some(prefix => tag.startsWith(prefix))),
	});
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
