#!/usr/bin/env bun

import { resolve } from 'node:path';
import { Effect } from 'effect';
import { z } from 'zod';
import { discover, resolvePublished } from '@/automation/managers';
import { adoptionChoices, adoptionMarkdown } from '@/automation/release-graph/adoption';
import { inferReleaseGraph } from '@/automation/release-graph/graph';
import { buildSnapshot } from '@/automation/snapshot';
import type { DomainError } from '@/contract/errors';
import { toDomainError } from '@/failure';
import type { ToolFailure } from '@/tooling/runtime';
import { attempt, main, parse, refuse } from '@/tooling/runtime';

function command(args: string[]): Effect.Effect<string, ToolFailure> {
	return attempt(() => Bun.spawnSync(args)).pipe(
		Effect.flatMap(result =>
			result.exitCode === 0
				? Effect.succeed(new TextDecoder().decode(result.stdout))
				: refuse('Could not read repository revision')
		),
	);
}

function ghApi(
	path: string,
	failure: (stderr: string) => Effect.Effect<null, ToolFailure>,
): Effect.Effect<unknown, ToolFailure> {
	return attempt(() => Bun.spawnSync(['gh', 'api', path])).pipe(
		Effect.flatMap((result): Effect.Effect<unknown, ToolFailure> =>
			result.exitCode === 0
				? attempt((): unknown => JSON.parse(new TextDecoder().decode(result.stdout)))
				: failure(new TextDecoder().decode(result.stderr))
		),
	);
}

const options = process.argv.slice(2).filter(value => value !== '--snapshot');
const fromGitHub = Effect.gen(function*() {
	const [name, ref] = (options[1] ?? '').split('@');
	if (!name || !/^\w[\w.-]*\/[\w.-]+$/.test(name)) return yield* refuse('Expected owner/repository[@ref]');
	const gh = <T extends z.ZodType>(path: string, schema: T) =>
		ghApi(path, () => refuse('Could not read repository revision')).pipe(Effect.flatMap(value => parse(schema, value)));
	const metadata = yield* gh(`repos/${name}`, z.object({ id: z.number(), default_branch: z.string() }));
	const { sha } = yield* gh(
		`repos/${name}/commits/${encodeURIComponent(ref || metadata.default_branch)}`,
		z.object({ sha: z.string() }),
	);
	const tree = yield* gh(
		`repos/${name}/git/trees/${sha}?recursive=1`,
		z.object({
			truncated: z.boolean(),
			tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
		}),
	);
	if (tree.truncated) return yield* refuse('Truncated repository tree');
	return yield* buildSnapshot({
		repository: { id: metadata.id, name, defaultBranch: metadata.default_branch },
		sha,
		entries: tree.tree,
		read: path =>
			gh(`repos/${name}/contents/${path}?ref=${sha}`, z.object({ size: z.number(), content: z.string() })).pipe(
				Effect.flatMap(file =>
					file.size > 1048576
						? refuse('Discovery file limit exceeded')
						: Effect.succeed(Buffer.from(file.content, 'base64').toString('utf8'))
				),
				Effect.mapError(toDomainError),
			),
		tags: prefixes =>
			Effect.forEach(
				prefixes,
				prefix =>
					gh(`repos/${name}/git/matching-refs/tags/${prefix}`, z.array(z.object({ ref: z.string() }))).pipe(
						Effect.map(rows => rows.map(row => row.ref.slice('refs/tags/'.length))),
					),
			).pipe(Effect.map(groups => groups.flat()), Effect.mapError(toDomainError)),
	});
});

const fromCheckout = Effect.gen(function*() {
	const root = resolve(options[0] ?? '.');
	const git = (...args: string[]) => command(['git', '-C', root, ...args]);
	const sha = (yield* git('rev-parse', 'HEAD')).trim();
	const remote = Bun.spawnSync(['git', '-C', root, 'remote', 'get-url', 'origin']);
	const name = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(new TextDecoder().decode(remote.stdout).trim())?.[1]
		?? 'local/inspection';
	const tags = (yield* git('tag', '--list')).split('\n').filter(Boolean);
	const entries = (yield* git('ls-tree', '-r', '-z', sha)).split('\0').filter(Boolean).map(line => {
		const [meta = '', path = ''] = line.split('\t');
		const [mode = '', type = ''] = meta.split(' ');
		return { path, type, mode };
	});
	return yield* buildSnapshot({
		repository: { id: 1, name, defaultBranch: 'HEAD' },
		sha,
		entries,
		read: path => git('show', `${sha}:${path}`).pipe(Effect.mapError(toDomainError)),
		tags: prefixes => Effect.succeed(tags.filter(tag => prefixes.some(prefix => tag.startsWith(prefix)))),
	});
});

function githubApi(path: string): Effect.Effect<unknown, DomainError> {
	return ghApi(path, stderr => stderr.includes('HTTP 404') ? Effect.succeed(null) : refuse(`gh api ${path} failed`))
		.pipe(Effect.mapError(toDomainError));
}

await main(
	Effect.gen(function*() {
		const github = options[0] === '--github';
		const snapshot = github ? yield* fromGitHub : yield* fromCheckout;
		if (process.argv.includes('--snapshot')) {
			console.log(JSON.stringify(snapshot, null, '\t'));
			return;
		}
		const inventory = yield* resolvePublished(
			discover(snapshot),
			fetch,
			github ? { repository: snapshot.repository.name, github: githubApi } : undefined,
		);
		const graph = inferReleaseGraph(snapshot, inventory);
		console.log(
			JSON.stringify(
				{
					repository: snapshot.repository,
					sha: snapshot.sha,
					inventory,
					streams: adoptionChoices(graph, inventory),
					releasePlan: adoptionMarkdown(graph, snapshot).join('\n'),
				},
				null,
				2,
			),
		);
	}),
);
