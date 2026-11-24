import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scope } from 'effect';
import { Effect, Schema } from 'effect';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { git as runGit } from '@/host/git.ts';
import { writeOutputTo } from '@/host/github-output.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { matchesPattern } from '@/kernel/schema/structs.ts';
import { bundleRuntime } from '@/tooling/actions/runtime-bundle';
import type { ToolFailure } from '@/tooling/runtime';
import { attempt, main, parse, refuse, temporaryDirectory } from '@/tooling/runtime';

const actionsSource = 'packages/actions/actions';
const actionsBranch = 'refs/heads/actions';

export type Distribution =
	| { readonly _tag: 'Published'; readonly commit: string }
	| { readonly _tag: 'Unchanged'; readonly commit: string };

const git = Effect.fnUntraced(function*(
	cwd: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
	input?: string,
): Effect.fn.Return<string, ToolFailure> {
	const result = yield* attempt(() => runGit(args, { cwd, env, ...(input === undefined ? {} : { input }) }));
	if (!result.ok) return yield* refuse(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	return result.stdout;
});

const publishedActions = Effect.fnUntraced(function*(
	root: string,
	env: NodeJS.ProcessEnv,
): Effect.fn.Return<void, ToolFailure> {
	const listing = yield* git(root, [
		'ls-files',
		'--stage',
		'--',
		':(glob)actions/**/action.yml',
		':(glob)actions/**/action.yaml',
	], env);
	for (const line of listing.split('\n').filter(Boolean)) {
		const [entry = '', path = ''] = line.split('\t');
		const [mode = '', blob = ''] = entry.split(' ');
		const read = yield* attempt(() => Bun.spawnSync(['git', 'cat-file', 'blob', blob], { cwd: root }));
		if (read.exitCode !== 0) return yield* refuse(`git cat-file blob ${blob} failed: ${read.stderr.toString().trim()}`);
		const source = read.stdout.toString();
		const published = source.replaceAll(`$/${actionsSource}/`, '$/actions/');
		if (published === source) continue;
		const rewritten = yield* git(root, ['hash-object', '-w', '--stdin'], env, published);
		yield* git(root, ['update-index', '--cacheinfo', `${mode},${rewritten},${path}`], env);
	}
});

export const distributionTree = Effect.fn('distributionTree')(function*(
	root: string,
	source: string,
	bundles: string,
): Effect.fn.Return<string, ToolFailure, Scope.Scope> {
	const index = yield* temporaryDirectory('beepboop-actions-index-');
	const env = { ...process.env, GIT_INDEX_FILE: join(index, 'index') };
	yield* git(root, ['read-tree', source], env);
	yield* git(root, ['read-tree', '--prefix=actions/', `${source}:${actionsSource}`], env);
	yield* publishedActions(root, env);
	for (const name of (yield* attempt(() => readdirSync(bundles))).filter(name => name.endsWith('.ts')).sort()) {
		const path = join(bundles, name);
		const blob = yield* git(root, ['hash-object', '-w', '--', path]);
		const executable = (yield* attempt(() => readFileSync(path, 'utf8'))).startsWith('#!');
		yield* git(root, [
			'update-index',
			'--add',
			'--cacheinfo',
			`${executable ? '100755' : '100644'},${blob},actions/runtime/${name}`,
		], env);
	}
	return yield* git(root, ['write-tree'], env);
}, Effect.scoped);

export const publishDistribution = Effect.fn('publishDistribution')(function*(
	root: string,
	source: string,
	bundles: string,
): Effect.fn.Return<Distribution, ToolFailure> {
	const tree = yield* distributionTree(root, source, bundles);
	const parents = ['-p', source];
	const [previous] = (yield* git(root, ['ls-remote', 'origin', actionsBranch])).split(/\s/);
	if (previous) {
		yield* git(root, ['fetch', '--no-tags', 'origin', previous]);
		const previousSource = yield* git(root, ['rev-parse', `${previous}^1`]);
		const ancestry = yield* attempt(() =>
			runGit(['merge-base', '--is-ancestor', previousSource, source], { cwd: root })
		);
		if (!ancestry.ok) {
			return yield* refuse(
				ancestry.stderr.trim() || `${previous} publishes ${previousSource}, which is not an ancestor of ${source}`,
			);
		}
		parents.push('-p', previous);
		const before = yield* git(root, ['rev-parse', `${previous}:actions`]);
		if (before === (yield* git(root, ['rev-parse', `${tree}:actions`]))) return { _tag: 'Unchanged', commit: previous };
	}
	const commit = yield* git(root, ['commit-tree', tree, ...parents, '-m', `Publish Actions from ${source}`]);
	yield* git(root, ['push', 'origin', `${commit}:${actionsBranch}`]);
	return { _tag: 'Published', commit };
});

const environmentSchema = Schema.Struct({
	GITHUB_SHA: Schema.String.check(matchesPattern(shaPattern)),
	GITHUB_OUTPUT: Schema.NonEmptyString,
	GITHUB_STEP_SUMMARY: Schema.NonEmptyString,
	GITHUB_SERVER_URL: Schema.NonEmptyString,
	GITHUB_REPOSITORY: Schema.String.check(matchesPattern(repositoryNamePattern)),
});

if (import.meta.main) {
	await main(Effect.scoped(Effect.gen(function*() {
		const root = process.cwd();
		const environment = yield* parse(environmentSchema, process.env);
		const source = environment.GITHUB_SHA;
		if ((yield* git(root, ['rev-parse', 'HEAD'])) !== source) return yield* refuse(`HEAD is not ${source}`);
		const clean = yield* attempt(() => runGit(['diff', '--quiet', 'HEAD'], { cwd: root }));
		if (!clean.ok) return yield* refuse(clean.stderr.trim() || `The checkout differs from ${source}`);
		const bundles = yield* temporaryDirectory('beepboop-actions-runtime-');
		yield* bundleRuntime(bundles);
		const distribution = yield* publishDistribution(root, source, bundles);
		yield* writeOutputTo(environment.GITHUB_OUTPUT, 'commit', distribution.commit).pipe(
			Effect.catch(failure => refuse(failure.message)),
		);
		const repository = `${environment.GITHUB_SERVER_URL}/${environment.GITHUB_REPOSITORY}`;
		const link = (commit: string) => `[\`${commit}\`](${repository}/commit/${commit})`;
		const summary = distribution._tag === 'Unchanged'
			? `Actions are unchanged since ${link(distribution.commit)}.\n`
			: `Source commit: ${link(source)}\nPublished Actions commit: ${link(distribution.commit)}\n`;
		yield* attempt(() => appendFileSync(environment.GITHUB_STEP_SUMMARY, summary));
	})));
}
